import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('V1 Slice 1: engine planning and compilation endpoints', () => {
  let engineProcess;

  function sendRequest(engine, request) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        engine.stdout.off('data', onData);
        reject(new Error('Timed out waiting for ' + request.requestId + '. Check stderr.'));
      }, 5000);
      
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
          } catch {}
        }
      };
      
      engine.stdout.on('data', onData);
      engine.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  before(async () => {
    engineProcess = spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    // Capture stderr to see why the engine might be crashing
    engineProcess.stderr.on('data', (data) => {
      console.error('\n[ENGINE STDERR]:', data.toString());
    });
    
    engineProcess.on('exit', (code) => {
      console.error('\n[ENGINE EXIT]: code ' + code);
    });

    await new Promise((r) => setTimeout(r, 500));
    
    if (engineProcess.exitCode !== null) {
      throw new Error('Engine crashed on startup with code ' + engineProcess.exitCode);
    }
  });

  after(async () => {
    if (engineProcess) { 
      engineProcess.kill(); 
      await new Promise((r) => engineProcess.on('exit', r)); 
    }
  });

  test('engine generates a read-only plan via task.plan', async () => {
    const req = {
      protocolVersion: 1,
      requestId: 'req-plan',
      method: 'task.plan',
      params: {
        contract: {
          taskId: 'v1-plan-001', title: 'Analyze repo', intent: 'Find bugs',
          domain: 'software', impact: 'low',
          outputs: [{ kind: 'report', format: 'markdown' }],
          acceptance: [{ id: 'a1', statement: 'Report generated' }],
        },
      },
      timestamp: new Date().toISOString(),
    };

    const res = await sendRequest(engineProcess, req);
    assert.equal(res.success, true, 'Plan request failed: ' + JSON.stringify(res.error));
    
    if ('steps' in res.result) {
      assert.ok(Array.isArray(res.result.steps));
      assert.ok(res.result.steps.every(s => s.readOnly === true));
    } else {
      assert.ok('reason' in res.result); // Honest refusal
    }
  });

  test('engine compiles a plan via task.compile', async () => {
    const req = {
      protocolVersion: 1,
      requestId: 'req-compile',
      method: 'task.compile',
      params: {
        plan: {
          taskId: 'v1-compile-001',
          steps: [
            { stepId: 's1', action: 'inspect', description: 'Look', readOnly: true, sources: [] }
          ],
          estimatedTotalModelCalls: 1,
          estimatedCostUsd: 0,
          modelUsed: 'fake',
          createdAt: new Date().toISOString(),
        },
        context: { targetPath: '/tmp', domain: 'software', impact: 'low' },
      },
      timestamp: new Date().toISOString(),
    };

    const res = await sendRequest(engineProcess, req);
    assert.equal(res.success, true, 'Compile request failed: ' + JSON.stringify(res.error));
    assert.equal(res.result.steps.length, 1);
    assert.equal(res.result.steps[0].action.kind, 'software.inspect');
    assert.equal(res.result.requiresApproval, false);
  });
});
