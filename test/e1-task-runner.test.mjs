import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runTask,
  InMemoryEventStore,
  InMemoryActionGuard,
} from '../packages/kernel/dist/index.js';

describe('E1 Slice 1: kernel TaskRunner', () => {
  test('runs a task with multiple steps and records durable events', async () => {
    const eventStore = new InMemoryEventStore();
    const actionGuard = new InMemoryActionGuard();

    let step1Ran = false;
    let step2Ran = false;

    const result = await runTask({
      taskId: 'task-001',
      steps: [
        {
          stepId: 'step-1',
          statement: 'First step',
          action: async () => {
            step1Ran = true;
            return { success: true };
          },
        },
        {
          stepId: 'step-2',
          statement: 'Second step',
          action: async () => {
            step2Ran = true;
            return { success: true };
          },
        },
      ],
      eventStore,
      actionGuard,
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(step1Ran, true);
    assert.equal(step2Ran, true);
    assert.equal(result.state.status, 'succeeded');
    
    // Check events were recorded
    assert.ok(result.events.length >= 4); // created, started, step1 queued/started/succeeded, step2 queued/started/succeeded, task succeeded
    assert.ok(result.events.some((e) => e.type === 'task.created'));
    assert.ok(result.events.some((e) => e.type === 'task.started'));
    assert.ok(result.events.some((e) => e.type === 'task.succeeded'));
  });

  test('stops on first step failure and records task.failed', async () => {
    const eventStore = new InMemoryEventStore();
    const actionGuard = new InMemoryActionGuard();

    let step2Ran = false;

    const result = await runTask({
      taskId: 'task-002',
      steps: [
        {
          stepId: 'step-1',
          statement: 'Failing step',
          action: async () => ({
            success: false,
            failureCategory: 'TERMINAL',
            errorMessage: 'Intentional failure',
          }),
        },
        {
          stepId: 'step-2',
          statement: 'Should not run',
          action: async () => {
            step2Ran = true;
            return { success: true };
          },
        },
      ],
      eventStore,
      actionGuard,
    });

    assert.equal(result.status, 'failed');
    assert.equal(step2Ran, false, 'Step 2 must not run after step 1 fails');
    assert.equal(result.state.status, 'failed');
    assert.ok(result.events.some((e) => e.type === 'task.failed'));
  });

  test('proves idempotency: re-running with same idempotency keys does not duplicate', async () => {
    const eventStore = new InMemoryEventStore();
    const actionGuard = new InMemoryActionGuard();

    let callCount = 0;

    const runOnce = async () => {
      await runTask({
        taskId: 'task-003',
        steps: [
          {
            stepId: 'step-1',
            statement: 'Idempotent step',
            action: async () => {
              callCount++;
              return { success: true };
            },
          },
        ],
        eventStore,
        actionGuard,
      });
    };

    await runOnce();
    await runOnce(); // Second run with same taskId

    assert.equal(callCount, 1, 'Action must only execute once due to idempotency');
    const events = await eventStore.listTaskEvents('task-003');
    const stepSucceeded = events.filter((e) => e.type === 'step.succeeded');
    assert.equal(stepSucceeded.length, 1, 'Only one step.succeeded event must exist');
  });
});