import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(p) { try { await access(p); return true; } catch { return false; } }

describe('E2 Slice 2: end-to-end real task execution', () => {
  let engineProcess;
  let collectedEvents = [];
  let responseData = null;
  let tempDir;
  const uniqueTaskId = 'e2e-task-' + Date.now();

  function runTaskAndWait(engine, request) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        engine.stdout.off('data', onData);
        reject(new Error('Timed out waiting for task completion'));
      }, 15000);

      const onData = (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.type && msg.taskId) collectedEvents.push(msg);
            if (msg.requestId === request.requestId) responseData = msg;
            if (msg.type === 'task.succeeded' || msg.type === 'task.failed' || msg.type === 'task.cancelled') {
              clearTimeout(timer);
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
    tempDir = await mkdtemp(path.join(tmpdir(), 'junub-e2e-'));
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "e2e@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "E2E"', { cwd: tempDir, stdio: 'ignore' });
    await writeFile(path.join(tempDir, 'seed.txt'), 'initial\n');
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "seed"', { cwd: tempDir, stdio: 'ignore' });

    await rm(path.join(REPO_ROOT, '.junub', 'tasks'), { recursive: true, force: true }).catch(() => {});

    engineProcess = spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, JUNUB_TASK_LOG_DIR: path.join(REPO_ROOT, '.junub', 'tasks') }
    });
    await new Promise((r) => setTimeout(r, 500));
  });

  after(async () => {
    if (engineProcess) { engineProcess.kill(); await new Promise((r) => engineProcess.on('exit', r)); }
    await rm(path.join(REPO_ROOT, '.junub', 'tasks'), { recursive: true, force: true }).catch(() => {});
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test('engine executes a real multi-step plan and mutates the filesystem', async () => {
    const req = {
      protocolVersion: 1,
      requestId: 'req-e2e-task',
      method: 'task.run',
      params: {
        contract: {
          taskId: uniqueTaskId,
          title: 'E2E Real Task',
          acceptance: [
            { id: 'step-1', statement: 'Inspect workspace' },
            { id: 'step-2', statement: 'Apply patch to create file' },
            { id: 'step-3', statement: 'Finalize task' },
          ],
        },
        plan: [
          {
            stepId: 'step-1',
            statement: 'Inspect workspace',
            action: { kind: 'software.inspect', params: { path: tempDir } }
          },
          {
            stepId: 'step-2',
            statement: 'Apply patch to create file',
            action: {
              kind: 'applyPatch',
              params: {
                path: tempDir,
                patch: {
                  schemaVersion: 1,
                  patchId: 'e2e-patch',
                  description: 'Create e2e file',
                  allowedPaths: ['e2e-test.txt'],
                  operations: [{ kind: 'create', path: 'e2e-test.txt', content: 'e2e success\n' }]
                }
              }
            }
          },
          {
            stepId: 'step-3',
            statement: 'Finalize task',
            action: { kind: 'noop', params: { statement: 'Finalize task' } }
          }
        ]
      },
      timestamp: new Date().toISOString(),
    };

    await runTaskAndWait(engineProcess, req);

    assert.equal(responseData.success, true);
    assert.equal(responseData.result.status, 'accepted');

    const types = collectedEvents.map((e) => e.type);
    assert.ok(types.includes('task.created'));
    assert.ok(types.includes('task.started'));
    
    // Verify all 3 steps succeeded
    const successCount = types.filter(t => t === 'step.succeeded').length;
    assert.equal(successCount, 3, `Expected 3 step.succeeded events, got ${successCount}. Events: ${JSON.stringify(types)}`);
    assert.ok(types.includes('task.succeeded'));

    // PROVE REAL MUTATION: The file must actually exist on disk
    const fileExists = await exists(path.join(tempDir, 'e2e-test.txt'));
    assert.equal(fileExists, true, 'applyPatch must have created the file on disk');

    const content = await readFile(path.join(tempDir, 'e2e-test.txt'), 'utf8');
    assert.equal(content, 'e2e success\n', 'File content must match the patch');
  });
});
