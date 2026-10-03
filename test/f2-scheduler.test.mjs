import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  openCraftDatabase,
  SqliteEventStore,
  SqliteActionGuard,
} from '../packages/storage/dist/index.js';

import {
  executeStep,
  CancellationToken,
} from '../packages/kernel/dist/index.js';

import { CraftError, CraftErrorCode } from '../packages/contracts/dist/index.js';

let tempDir;
let db;
let eventStore;
let actionGuard;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'craft-f2-sched-'));
  const databaseFile = path.join(tempDir, 'craft.sqlite');
  db = openCraftDatabase(databaseFile);
  eventStore = new SqliteEventStore(db);
  actionGuard = new SqliteActionGuard(db);
});

after(async () => {
  if (eventStore) await eventStore.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

test('executor retries TRANSIENT failures and eventually succeeds', async () => {
  let attempts = 0;
  const runner = async () => {
    attempts++;
    if (attempts < 3) {
      return { success: false, failureCategory: 'TRANSIENT', errorMessage: 'Network blip' };
    }
    return { success: true };
  };

  await executeStep(
    { taskId: 'task-retry', stepId: 'step-1', idempotencyKey: 'idem-1' },
    runner,
    { eventStore, actionGuard, sleep: async () => {} } // mock sleep for speed
  );

  assert.equal(attempts, 3);
  const events = await eventStore.listTaskEvents('task-retry');
  const succeeded = events.find(e => e.type === 'step.succeeded');
  assert.ok(succeeded, 'Step should eventually succeed');
});

test('executor does not retry FIXABLE failures', async () => {
  let attempts = 0;
  const runner = async () => {
    attempts++;
    return { success: false, failureCategory: 'FIXABLE', errorMessage: 'Validation error' };
  };

  await assert.rejects(
    executeStep(
      { taskId: 'task-fixable', stepId: 'step-1', idempotencyKey: 'idem-2' },
      runner,
      { eventStore, actionGuard, sleep: async () => {} }
    ),
    (err) => err instanceof CraftError
  );

  assert.equal(attempts, 1, 'FIXABLE failures must not retry');
});

test('executor stops cleanly when budget is exhausted', async () => {
  let attempts = 0;
  const runner = async () => {
    attempts++;
    return { success: false, failureCategory: 'TRANSIENT', errorMessage: 'Timeout' };
  };

  await assert.rejects(
    executeStep(
      {
        taskId: 'task-budget',
        stepId: 'step-1',
        idempotencyKey: 'idem-3',
        limits: { maxRetryAttempts: 2 } // Force budget stop at attempt 3
      },
      runner,
      { eventStore, actionGuard, sleep: async () => {} }
    ),
    (err) => err instanceof CraftError && err.code === CraftErrorCode.BUDGET_EXCEEDED
  );

  assert.equal(attempts, 2, 'Should stop exactly at budget limit');
});

test('executor respects cancellation token cleanly', async () => {
  const token = new CancellationToken();
  let attempts = 0;

  const runner = async () => {
    attempts++;
    token.cancel(); // Cancel immediately during first attempt
    return { success: false, failureCategory: 'TRANSIENT', errorMessage: 'Slow' };
  };

  // Should NOT throw, because cancellation is a clean exit
  await executeStep(
    { taskId: 'task-cancel', stepId: 'step-1', idempotencyKey: 'idem-4', cancelToken: token },
    runner,
    { eventStore, actionGuard, sleep: async () => {} }
  );

  assert.equal(attempts, 1, 'Should not retry after cancellation');
  const events = await eventStore.listTaskEvents('task-cancel');
  const cancelled = events.find(e => e.type === 'step.cancelled');
  assert.ok(cancelled, 'Should record clean cancellation in event log');
});

