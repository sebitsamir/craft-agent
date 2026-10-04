import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import type { StoredTaskEvent } from '../port/event-store.js'
import { FAILURE_CATEGORIES, type FailureCategory } from '../failure.js';

/**
 * Canonical task/step event types for F2.
 *
 * These are durable event log types, not protocol transport types.
 * They map directly to the state machine transitions defined in the Master Spec.
 */
export const TASK_EVENT_TYPES = {
  taskCreated: 'task.created',
  taskStarted: 'task.started',
  taskSucceeded: 'task.succeeded',
  taskFailed: 'task.failed',
  taskBlocked: 'task.blocked',
  taskCancelled: 'task.cancelled',

  stepQueued: 'step.queued',
  stepStarted: 'step.started',
  stepSucceeded: 'step.succeeded',
  stepFailed: 'step.failed',
  stepBlocked: 'step.blocked',

  // F2 Slice 2 additions for retry and cancel semantics
  stepRetryWait: 'step.retry_wait',
  stepCancelled: 'step.cancelled',
} as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[keyof typeof TASK_EVENT_TYPES];

/**
 * High-level task run status.
 */
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled';

/**
 * Step run status.
 * Includes the full F2 anti-stall vocabulary from the Master Spec.
 */
export type StepStatus =
  | 'queued'
  | 'running'
  | 'input_required'
  | 'approval_required'
  | 'retry_wait'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'succeeded'
  | 'verified';

/**
 * In-memory state for one step.
 */
export interface StepRunState {
  readonly stepId: string;
  readonly status: StepStatus;
  readonly attempts: number;
  readonly failureCategory?: FailureCategory;
  readonly lastErrorMessage?: string;
  readonly updatedAt: string;
}

/**
 * Immutable task run state reconstructed by replaying stored events.
 */
export interface TaskRunState {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly steps: ReadonlyMap<string, StepRunState>;
  readonly lastSequence: number;
  readonly updatedAt?: string;
}

/**
 * Internal mutable draft used while applying exactly one event.
 */
interface TaskRunDraft {
  taskId: string;
  status: TaskStatus;
  steps: Map<string, StepRunState>;
  lastSequence: number;
  updatedAt?: string;
}

/**
 * Creates an empty task run state before replay.
 */
export function createTaskRun(taskId: string): TaskRunState {
  return {
    taskId,
    status: 'queued',
    steps: new Map<string, StepRunState>(),
    lastSequence: 0,
  };
}

/**
 * Applies one stored event to a task run state.
 * This function is deterministic and strict.
 */
export function applyTaskEvent(
  state: TaskRunState,
  event: StoredTaskEvent,
): TaskRunState {
  if (event.taskId !== state.taskId) {
    throw new JunubError(
      JunubErrorCode.TASK_STATE_INVALID,
      `Event belongs to task "${event.taskId}" but replay is for task "${state.taskId}".`,
      { eventTaskId: event.taskId, replayTaskId: state.taskId },
    );
  }

  if (event.sequence !== state.lastSequence + 1) {
    throw new JunubError(
      JunubErrorCode.EVENT_SEQUENCE_INVALID,
      `Expected event sequence ${state.lastSequence + 1} but received ${event.sequence}.`,
      { expectedSequence: state.lastSequence + 1, actualSequence: event.sequence },
    );
  }

  const next: TaskRunDraft = {
    taskId: state.taskId,
    status: state.status,
    steps: new Map(state.steps),
    lastSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  const payload = asPayloadRecord(event.payload);

  switch (event.type) {
    case TASK_EVENT_TYPES.taskCreated: { next.status = 'queued'; return next; }
    case TASK_EVENT_TYPES.taskStarted: { next.status = 'running'; return next; }
    case TASK_EVENT_TYPES.taskSucceeded: { next.status = 'succeeded'; return next; }
    case TASK_EVENT_TYPES.taskFailed: { next.status = 'failed'; return next; }
    case TASK_EVENT_TYPES.taskBlocked: { next.status = 'blocked'; return next; }
    case TASK_EVENT_TYPES.taskCancelled: { next.status = 'cancelled'; return next; }

    case TASK_EVENT_TYPES.stepQueued: {
      const stepId = readRequiredString(payload, 'stepId', event);
      next.steps.set(stepId, { stepId, status: 'queued', attempts: 0, updatedAt: event.occurredAt });
      return next;
    }

    case TASK_EVENT_TYPES.stepStarted: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);
      next.steps.set(stepId, { ...step, status: 'running', attempts: step.attempts + 1, updatedAt: event.occurredAt });
      return next;
    }

    case TASK_EVENT_TYPES.stepSucceeded: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);
      next.steps.set(stepId, { ...step, status: 'succeeded', updatedAt: event.occurredAt });
      return next;
    }

    case TASK_EVENT_TYPES.stepFailed: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);
      const failureCategory = readOptionalFailureCategory(payload, event);
      const lastErrorMessage = readOptionalString(payload, 'message');
      next.steps.set(stepId, { ...step, status: 'failed', failureCategory, lastErrorMessage, updatedAt: event.occurredAt });
      return next;
    }

    case TASK_EVENT_TYPES.stepBlocked: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);
      next.steps.set(stepId, { ...step, status: 'blocked', updatedAt: event.occurredAt });
      return next;
    }

    // F2 Slice 2: Retry Wait State
    case TASK_EVENT_TYPES.stepRetryWait: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);
      next.steps.set(stepId, { ...step, status: 'retry_wait', updatedAt: event.occurredAt });
      return next;
    }

    // F2 Slice 2: Cancelled State
    case TASK_EVENT_TYPES.stepCancelled: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);
      next.steps.set(stepId, { ...step, status: 'cancelled', updatedAt: event.occurredAt });
      return next;
    }

    default: {
      throw new JunubError(
        JunubErrorCode.TASK_STATE_INVALID,
        `Unknown task event type "${event.type}".`,
        { eventId: event.eventId, type: event.type },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function asPayloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new JunubError(JunubErrorCode.EVENT_MALFORMED, 'Event payload must be an object when present.');
  }
  return payload as Record<string, unknown>;
}

function readRequiredString(payload: Record<string, unknown>, field: string, event: StoredTaskEvent): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new JunubError(JunubErrorCode.EVENT_MALFORMED, `Event "${event.type}" payload requires nonempty string "${field}".`);
  }
  return value;
}

function readOptionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined || value === null || typeof value !== 'string') return undefined;
  return value;
}

function readOptionalFailureCategory(payload: Record<string, unknown>, event: StoredTaskEvent): FailureCategory | undefined {
  const value = payload.failureCategory;
  if (value === undefined || value === null) return undefined;
  if (!isFailureCategory(value)) {
    throw new JunubError(JunubErrorCode.EVENT_MALFORMED, `Event "${event.type}" payload has invalid failureCategory "${String(value)}".`);
  }
  return value;
}

function isFailureCategory(value: unknown): value is FailureCategory {
  return typeof value === 'string' && (FAILURE_CATEGORIES as readonly string[]).includes(value);
}

function requireExistingStep(state: TaskRunDraft, stepId: string, event: StoredTaskEvent): StepRunState {
  const step = state.steps.get(stepId);
  if (!step) {
    throw new JunubError(JunubErrorCode.TASK_STATE_INVALID, `Event "${event.type}" references unknown step "${stepId}".`);
  }
  return step;
}
