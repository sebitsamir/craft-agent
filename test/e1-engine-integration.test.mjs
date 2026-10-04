import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('E1 Slice 2: engine streams real durable task events', () => {
  let engineProcess;
  let collectedEvents = [];
  let responseData = null;

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
            
            // Capture streaming protocol events
            if (msg.type && msg.taskId) {
              collectedEvents.push(msg);
            }
            
            // Capture the initial accepted response
            if (msg.requestId === request.requestId) {
              responseData = msg;
            }

            // Resolve when the task finishes executing (streaming complete)
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
    engineProcess = spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Give the engine a moment to start listening on stdin
    await new Promise(r => setTimeout(r, 500));
  });

  after(async () => {
    if (engineProcess) {
      engineProcess.kill();
      // Wait for process to cleanly exit so the event loop can resolve
      await new Promise(r => engineProcess.on('exit', r));
    }
  });

  test('engine executes real steps and streams durable events to stdout', async () => {
    const req = {
      protocolVersion: 1,
      requestId: 'req-real-task',
      method: 'task.run',
      params: {
        contract: {
          taskId: 'real-task-001',
          title: 'Real Execution',
          acceptance: [
            { id: 'step-A', statement: 'Do real work A' },
            { id: 'step-B', statement: 'Do real work B' },
          ],
        },
      },
      timestamp: new Date().toISOString(),
    };

    // Send the request and wait for the final task event
    await runTaskAndWait(engineProcess, req);

    // 1. Verify the immediate response was accepted
    assert.equal(responseData.success, true);
    assert.equal(responseData.result.status, 'accepted');

    // 2. Verify the real F2 event sequence streamed to stdout
    const types = collectedEvents.map((e) => e.type);
    
    assert.ok(types.includes('task.created'), 'Must emit task.created');
    assert.ok(types.includes('task.started'), 'Must emit task.started');
    assert.ok(types.includes('step.queued'), 'Must emit step.queued');
    assert.ok(types.includes('step.started'), 'Must emit step.started');
    assert.ok(types.includes('step.succeeded'), 'Must emit step.succeeded');
    assert.ok(types.includes('task.succeeded'), 'Must emit task.succeeded');
    
    // Verify strict ordering for the first step
    const idxCreated = types.indexOf('task.created');
    const idxQueued = types.indexOf('step.queued');
    const idxStarted = types.indexOf('step.started');
    const idxSucceeded = types.indexOf('step.succeeded');
    
    assert.ok(idxCreated < idxQueued, 'task.created must precede step.queued');
    assert.ok(idxQueued < idxStarted, 'step.queued must precede step.started');
    assert.ok(idxStarted < idxSucceeded, 'step.started must precede step.succeeded');
  });
});