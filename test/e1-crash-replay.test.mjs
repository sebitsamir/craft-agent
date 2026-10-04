import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function spawnEngine(logDir) {
  return spawn('node', [path.join(REPO_ROOT, 'src/engine.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, JUNUB_TASK_LOG_DIR: logDir },
  });
}

function collectEvents(proc, sink) {
  proc.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      try {
        const msg = JSON.parse(line);
        if (msg.type && msg.taskId) sink.push(msg);
      } catch {}
    }
  });
}

function sendTask(proc, taskId) {
  proc.stdin.write(
    JSON.stringify({
      protocolVersion: 1,
      requestId: `req-${taskId}`,
      method: 'task.run',
      params: {
        contract: {
          taskId,
          title: 'crash test',
          acceptance: [
            { id: 'step-A', statement: 'fast step' },
            { id: 'step-B', statement: 'slow step' },
          ],
        },
      },
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
}

describe('E1 Slice 3: crash and replay', () => {
  let logDir;
  const procs = [];

  after(async () => {
    for (const p of procs) { try { p.kill(); } catch {} }
    if (logDir) await rm(logDir, { recursive: true, force: true });
  });

  test('a killed engine resumes without re-running completed steps', async () => {
    logDir = await mkdtemp(path.join(tmpdir(), 'junub-e1-crash-'));

    // Engine 1: start the task, then kill it mid step-B.
    const e1 = spawnEngine(logDir); procs.push(e1);
    collectEvents(e1, []);
    await new Promise((r) => setTimeout(r, 500));
    sendTask(e1, 'crash-task');
    await new Promise((r) => setTimeout(r, 2000)); // step-A (0.4s) done; step-B (3s) in flight
    e1.kill();
    await new Promise((r) => e1.on('exit', r));

    // Engine 2: resume the same task from the durable log.
    const e2 = spawnEngine(logDir); procs.push(e2);
    collectEvents(e2, []);
    await new Promise((r) => setTimeout(r, 500));
    sendTask(e2, 'crash-task');

    await new Promise((resolve) => {
      const t = setTimeout(resolve, 8000);
      const onData = (data) => {
        for (const line of data.toString().split('\n').filter(Boolean)) {
          try {
            const m = JSON.parse(line);
            if (m.type === 'task.succeeded' && m.taskId === 'crash-task') {
              clearTimeout(t);
              e2.stdout.off('data', onData);
              resolve();
            }
          } catch {}
        }
      };
      e2.stdout.on('data', onData);
    });
    e2.kill();
    await new Promise((r) => e2.on('exit', r));

    // Read the durable log and verify no duplicate work.
    const raw = await readFile(path.join(logDir, 'crash-task.jsonl'), 'utf8');
    const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));

    const count = (type, stepId) =>
      events.filter((e) => e.type === type && (!stepId || e.payload?.stepId === stepId)).length;

    assert.equal(count('step.succeeded', 'step-A'), 1, 'step-A must succeed exactly once');
    assert.equal(count('step.started', 'step-A'), 1, 'step-A must start exactly once (not re-run)');
    assert.equal(count('step.succeeded', 'step-B'), 1, 'step-B must succeed exactly once after resume');
    assert.equal(count('task.succeeded'), 1, 'task must succeed exactly once');
  });
});