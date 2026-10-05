import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('E1 Slice 2: engine streams real durable task events', () => {
  let engineProcess;
  let collectedEvents = [];
  let responseData = null;
  const uniqueTaskId = 'e1-integration-' + Date.now();

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
    engineProcess = spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise((r) => setTimeout(r, 500));
  });

  after(async () => {
    if (engineProcess) { engineProcess.kill(); await new Promise((r) => engineProcess.on('exit', r)); }
    await rm(path.join(REPO_ROOT, '.junub', 'tasks'), { recursive: true, force: true }).catch(() => {});
  });

  test('engine executes real steps and streams durable events to stdout', async () => {
    const req = {
      protocolVersion: 1,
      requestId: 'req-real-task',
      method: 'task.run',
      params: {
        contract: {
          taskId: uniqueTaskId,
          title: 'Real Execution',
          acceptance: [
            { id: 'step-A', statement: 'Do real work A' },
            { id: 'step-B', statement: 'Do real work B' },
          ],
        },
      },
      timestamp: new Date().toISOString(),
    };

    await runTaskAndWait(engineProcess, req);

    assert.equal(responseData.success, true);
    assert.equal(responseData.result.status, 'accepted');

    const types = collectedEvents.map((e) => e.type);
    assert.ok(types.includes('task.created'));
    assert.ok(types.includes('task.started'));
    assert.ok(types.includes('step.queued'));
    assert.ok(types.includes('step.started'));
    assert.ok(types.includes('step.succeeded'));
    assert.ok(types.includes('task.succeeded'));
  });
});
