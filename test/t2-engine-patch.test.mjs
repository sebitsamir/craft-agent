import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('T2 Slice 3: engine routing for film patch', () => {
  let tempDir;
  let engineProcess;

  function sendRequest(engine, request, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        engine.stdout.off('data', onData);
        reject(new Error(`Timed out waiting for response to ${request.requestId}`));
      }, timeoutMs);

      const onData = (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.requestId === request.requestId) {
              clearTimeout(timer);
              engine.stdout.off('data', onData);
              resolve(msg);
            }
          } catch { }
        }
      };

      engine.stdout.on('data', onData);
      engine.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'junub-t2-engine-patch-'));
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "t@e.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "T"', { cwd: tempDir, stdio: 'ignore' });
    await mkdir(path.join(tempDir, 'media'), { recursive: true });
    await writeFile(path.join(tempDir, 'media', 'shot.mp4'), 'bytes');
    await writeFile(path.join(tempDir, 'cut.edl'), '* FROM CLIP NAME:  shot.mp4\n');
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "seed"', { cwd: tempDir, stdio: 'ignore' });

    engineProcess = spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  after(async () => {
    if (engineProcess) engineProcess.kill();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test('engine routes pack.film.applyPatch for a timeline edit', async () => {
    const res = await sendRequest(engineProcess, {
      protocolVersion: 1,
      requestId: 'req-film-patch-ok',
      method: 'pack.film.applyPatch',
      params: {
        path: tempDir,
        patch: {
          schemaVersion: 1, patchId: 'p-edl', description: 'update edl',
          allowedPaths: ['cut.edl'],
          operations: [{ kind: 'update', path: 'cut.edl', content: '* FROM CLIP NAME:  shot.mp4\n* v2\n' }],
        },
      },
      timestamp: new Date().toISOString(),
    });

    assert.equal(res.success, true);
    assert.equal(res.result.scopeViolation, false);
    assert.equal(res.result.applied, true);
    assert.equal(res.result.mediaLinksPassed, true);
  });

  test('engine reports scope violation for a media-targeting patch', async () => {
    const res = await sendRequest(engineProcess, {
      protocolVersion: 1,
      requestId: 'req-film-patch-media',
      method: 'pack.film.applyPatch',
      params: {
        path: tempDir,
        patch: {
          schemaVersion: 1, patchId: 'p-media', description: 'try media',
          allowedPaths: ['media/shot.mp4'],
          operations: [{ kind: 'update', path: 'media/shot.mp4', content: 'x' }],
        },
      },
      timestamp: new Date().toISOString(),
    });

    assert.equal(res.success, true);
    assert.equal(res.result.scopeViolation, true);
    assert.equal(res.result.applied, false);
  });
});
