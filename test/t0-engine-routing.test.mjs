import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('T0 Slice 3: Engine routing for film pack', () => {
  let tempDir;
  let engineProcess;

  function sendRequest(engine, request) {
    return new Promise((resolve) => {
      const onData = (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.requestId === request.requestId) {
              engine.stdout.off('data', onData);
              resolve(msg);
            }
          } catch {}
        }
      };
      engine.stdout.on('data', onData);
      engine.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'junub-t0-engine-'));
    await mkdir(path.join(tempDir, 'media'), { recursive: true });
    await writeFile(path.join(tempDir, 'media', 'shot.mp4'), 'data');
    const edl = `* FROM CLIP NAME:  shot.mp4\n* FROM CLIP NAME:  missing.mov\n`;
    await writeFile(path.join(tempDir, 'cut.edl'), edl);
  });

  after(async () => {
    if (engineProcess) engineProcess.kill();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test('engine routes pack.film.inspect and pack.film.verify via NDJSON', async () => {
    engineProcess = spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 1. Test pack.film.inspect
    const inspectReq = {
      protocolVersion: 1,
      requestId: 'req-film-inspect',
      method: 'pack.film.inspect',
      params: { path: tempDir },
      timestamp: new Date().toISOString()
    };

    const inspectRes = await sendRequest(engineProcess, inspectReq);
    assert.equal(inspectRes.success, true);
    assert.equal(inspectRes.result.timelines.length, 1);
    assert.equal(inspectRes.result.timelines[0].referencedClips.length, 2);

    // 2. Test pack.film.verify
    const verifyReq = {
      protocolVersion: 1,
      requestId: 'req-film-verify',
      method: 'pack.film.verify',
      params: { path: tempDir },
      timestamp: new Date().toISOString()
    };

    const verifyRes = await sendRequest(engineProcess, verifyReq);
    assert.equal(verifyRes.success, true);
    assert.equal(verifyRes.result.passed, false);
    assert.equal(verifyRes.result.checks.length, 2);

    const missing = verifyRes.result.checks.find(c => c.clipName === 'missing.mov');
    assert.equal(missing.status, 'missing');

    engineProcess.kill();
  });
});
