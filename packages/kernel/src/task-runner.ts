import { randomUUID } from 'node:crypto';
import type { EventStore, StoredTaskEvent } from './port/event-store.js';
import type { ActionGuard } from './port/action-guard.js';
import {
  executeStep,
  type StepExecutionInput,
  type StepActionResult,
  type StepExecutorDeps,
} from './scheduler/executor.js';
import {
  TASK_EVENT_TYPES,
  createTaskRun,
  applyTaskEvent,
  type TaskRunState,
} from './state/task-run.js';

/**
 * A step derived from a task contract's acceptance criterion.
 */
export interface TaskStep {
  readonly stepId: string;
  readonly statement: string;
  readonly action: (input: StepExecutionInput, attempt: number) => Promise<StepActionResult>;
}

/**
 * Input for running a complete task.
 */
export interface RunTaskInput {
  readonly taskId: string;
  readonly steps: readonly TaskStep[];
  readonly eventStore: EventStore;
  readonly actionGuard: ActionGuard;
}

/**
 * The result of a complete task run.
 */
export interface TaskRunResult {
  readonly taskId: string;
  readonly status: 'succeeded' | 'failed';
  readonly state: TaskRunState;
  readonly events: readonly StoredTaskEvent[];
}

const TERMINAL_STEP_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Replays the event log to reconstruct the current task state.
 */
async function replayState(
  taskId: string,
  eventStore: EventStore,
): Promise<{ state: TaskRunState; events: StoredTaskEvent[] }> {
  const events = await eventStore.listTaskEvents(taskId);
  let state = createTaskRun(taskId);
  for (const event of events) {
    state = applyTaskEvent(state, event);
  }
  return { state, events };
}

/**
 * Emits a lifecycle event for the task with a deterministic idempotency key.
 */
async function emitTaskEvent(
  taskId: string,
  type: typeof TASK_EVENT_TYPES[keyof typeof TASK_EVENT_TYPES],
  suffix: string,
  eventStore: EventStore,
  payload: unknown = {},
): Promise<void> {
  await eventStore.appendTaskEvent({
    taskId,
    eventId: randomUUID(),
    type,
    payload,
    idempotencyKey: `${taskId}:${suffix}`,
  });
}

/**
 * Runs a complete task by executing each step via the F2 executor.
 *
 * This is the bridge between a task contract and the durable step execution
 * machinery. It handles idempotency, lifecycle events, and step orchestration.
 */
export async function runTask(input: RunTaskInput): Promise<TaskRunResult> {
  const { taskId, steps, eventStore, actionGuard } = input;
  const deps: StepExecutorDeps = { eventStore, actionGuard };

  // 1. Replay existing state to check for idempotency
  const { state: initialState } = await replayState(taskId, eventStore);

  if (TERMINAL_STEP_STATUSES.has(initialState.status)) {
    const events = await eventStore.listTaskEvents(taskId);
    return {
      taskId,
      status: initialState.status === 'succeeded' ? 'succeeded' : 'failed',
      state: initialState,
      events,
    };
  }

  // 2. Emit task lifecycle start events
  await emitTaskEvent(taskId, TASK_EVENT_TYPES.taskCreated, 'created', eventStore);
  await emitTaskEvent(taskId, TASK_EVENT_TYPES.taskStarted, 'started', eventStore);

  // 3. Execute steps
  let finalStatus: 'succeeded' | 'failed' = 'succeeded';

  for (const step of steps) {
    const stepState = initialState.steps.get(step.stepId);
    
    // Skip steps that already reached a terminal state in a previous run
    if (stepState && TERMINAL_STEP_STATUSES.has(stepState.status)) {
      if (stepState.status !== 'succeeded') {
        finalStatus = 'failed';
      }
      continue;
    }

    try {
      await executeStep(
        {
          taskId,
          stepId: step.stepId,
          idempotencyKey: `${taskId}:${step.stepId}`,
        },
        step.action,
        deps,
      );
    } catch (err) {
      finalStatus = 'failed';
      break; // Stop on first failure
    }
  }

  // 4. Emit task completion event
  const completionType = finalStatus === 'succeeded' 
    ? TASK_EVENT_TYPES.taskSucceeded 
    : TASK_EVENT_TYPES.taskFailed;
    
  await emitTaskEvent(taskId, completionType, finalStatus, eventStore);

  // 5. Reconstruct final state
  const { state: finalState, events } = await replayState(taskId, eventStore);

  return {
    taskId,
    status: finalStatus,
    state: finalState,
    events,
  };
}

// ---------------------------------------------------------------------------
// In-memory implementations for testing
// ---------------------------------------------------------------------------

/**
 * Simple in-memory EventStore for testing.
 */
export class InMemoryEventStore implements EventStore {
  private events = new Map<string, StoredTaskEvent[]>();

  async appendTaskEvent(request: { taskId: string; eventId: string; type: string; payload?: unknown; idempotencyKey?: string; occurredAt?: string }): Promise<StoredTaskEvent> {
    const taskEvents = this.events.get(request.taskId) ?? [];
    
    // Check idempotency
    const existing = taskEvents.find(
      (e) => e.idempotencyKey && e.idempotencyKey === request.idempotencyKey,
    );
    if (existing) return existing;

    const stored: StoredTaskEvent = {
      taskId: request.taskId,
      sequence: taskEvents.length + 1,
      eventId: request.eventId,
      type: request.type,
      payload: request.payload ?? {},
      idempotencyKey: request.idempotencyKey,
      occurredAt: request.occurredAt ?? new Date().toISOString(),
      recordedAt: new Date().toISOString(),
    };

    taskEvents.push(stored);
    this.events.set(request.taskId, taskEvents);
    return stored;
  }

  async listTaskEvents(taskId: string): Promise<StoredTaskEvent[]> {
    return this.events.get(taskId) ?? [];
  }

  async close(): Promise<void> {
    // No-op for in-memory
  }
}

/**
 * Simple in-memory ActionGuard for testing.
 */
export class InMemoryActionGuard implements ActionGuard {
  private actions = new Map<string, { executionId: string; taskId: string; stepId?: string; idempotencyKey: string; status: 'reserved' | 'completed' | 'failed'; result?: unknown; error?: unknown; reservedAt: string; completedAt?: string }>();

  async reserveExternalAction(input: { taskId: string; stepId?: string; idempotencyKey: string }): Promise<{ executionId: string; taskId: string; stepId?: string; idempotencyKey: string; status: 'reserved' | 'completed' | 'failed'; result?: unknown; error?: unknown; reservedAt: string; completedAt?: string; alreadyExisted: boolean }> {
    const existing = this.actions.get(input.idempotencyKey);
    if (existing) {
      return { ...existing, alreadyExisted: true };
    }

    const record = {
      executionId: randomUUID(),
      taskId: input.taskId,
      stepId: input.stepId,
      idempotencyKey: input.idempotencyKey,
      status: 'reserved' as const,
      reservedAt: new Date().toISOString(),
    };

    this.actions.set(input.idempotencyKey, record);
    return { ...record, alreadyExisted: false };
  }

  async completeExternalAction(input: { idempotencyKey: string; result?: unknown }): Promise<{ executionId: string; taskId: string; stepId?: string; idempotencyKey: string; status: 'reserved' | 'completed' | 'failed'; result?: unknown; error?: unknown; reservedAt: string; completedAt?: string }> {
    const record = this.actions.get(input.idempotencyKey);
    if (!record) {
      throw new Error(`Cannot complete unknown external action: ${input.idempotencyKey}`);
    }

    const updated = {
      ...record,
      status: 'completed' as const,
      result: input.result,
      completedAt: new Date().toISOString(),
    };

    this.actions.set(input.idempotencyKey, updated);
    return updated;
  }

  async failExternalAction(input: { idempotencyKey: string; error?: unknown }): Promise<{ executionId: string; taskId: string; stepId?: string; idempotencyKey: string; status: 'reserved' | 'completed' | 'failed'; result?: unknown; error?: unknown; reservedAt: string; completedAt?: string }> {
    const record = this.actions.get(input.idempotencyKey);
    if (!record) {
      throw new Error(`Cannot fail unknown external action: ${input.idempotencyKey}`);
    }

    const updated = {
      ...record,
      status: 'failed' as const,
      error: input.error,
      completedAt: new Date().toISOString(),
    };

    this.actions.set(input.idempotencyKey, updated);
    return updated;
  }
}