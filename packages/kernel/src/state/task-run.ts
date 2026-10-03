import { CraftError, CraftErrorCode } from '@craft-agent/contracts';
import type { StoredTaskEvent } from '../port/event-store.js'
import { FAILURE_CATEGORIES, type FailureCategory } from '../failure.js';

/**
 * Canonical task/step event types for F2 Slice 1.
 *
 * These are durable event log types, not protocol transport types.
 * They are intentionally small. The DAG scheduler slice will extend them.
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
 *
 * This includes the full F2 anti-stall vocabulary from the Master Spec.
 * Slice 1 uses a subset, but the type is already future-safe.
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
 *
 * This state is derived. The event log is authoritative.
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
 *
 * Callers never see this type. They always receive the immutable
 * TaskRunState shape. This keeps the reducer easy to read while the
 * public contract stays readonly.
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
 *
 * This function is deterministic. It must never silently accept
 * out-of-order events, because the event log is the source of truth.
 */
export function applyTaskEvent(
  state: TaskRunState,
  event: StoredTaskEvent,
): TaskRunState {
  // Guard: events must belong to the task being replayed.
  if (event.taskId !== state.taskId) {
    throw new CraftError(
      CraftErrorCode.TASK_STATE_INVALID,
      `Event belongs to task "${event.taskId}" but replay is for task "${state.taskId}".`,
      {
        eventTaskId: event.taskId,
        replayTaskId: state.taskId,
      },
    );
  }

  // Guard: sequence must increase by exactly one.
  // This detects missing or duplicated events during recovery.
  if (event.sequence !== state.lastSequence + 1) {
    throw new CraftError(
      CraftErrorCode.EVENT_SEQUENCE_INVALID,
      `Expected event sequence ${state.lastSequence + 1} but received ${event.sequence}.`,
      {
        expectedSequence: state.lastSequence + 1,
        actualSequence: event.sequence,
      },
    );
  }

  // Create a mutable draft from the previous immutable state.
  const next: TaskRunDraft = {
    taskId: state.taskId,
    status: state.status,
    steps: new Map(state.steps),
    lastSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  // Event payload is treated as a structured object.
  const payload = asPayloadRecord(event.payload);

  switch (event.type) {
    // -----------------------------------------------------------------------
    // Task-level transitions.
    // -----------------------------------------------------------------------

    case TASK_EVENT_TYPES.taskCreated: {
      next.status = 'queued';
      return next;
    }

    case TASK_EVENT_TYPES.taskStarted: {
      next.status = 'running';
      return next;
    }

    case TASK_EVENT_TYPES.taskSucceeded: {
      next.status = 'succeeded';
      return next;
    }

    case TASK_EVENT_TYPES.taskFailed: {
      next.status = 'failed';
      return next;
    }

    case TASK_EVENT_TYPES.taskBlocked: {
      next.status = 'blocked';
      return next;
    }

    case TASK_EVENT_TYPES.taskCancelled: {
      next.status = 'cancelled';
      return next;
    }

    // -----------------------------------------------------------------------
    // Step-level transitions.
    // -----------------------------------------------------------------------

    case TASK_EVENT_TYPES.stepQueued: {
      const stepId = readRequiredString(payload, 'stepId', event);

      // A queued event creates or resets the step state.
      next.steps.set(stepId, {
        stepId,
        status: 'queued',
        attempts: 0,
        updatedAt: event.occurredAt,
      });

      return next;
    }

    case TASK_EVENT_TYPES.stepStarted: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);

      // Starting a step increments its attempt counter.
      next.steps.set(stepId, {
        ...step,
        status: 'running',
        attempts: step.attempts + 1,
        updatedAt: event.occurredAt,
      });

      return next;
    }

    case TASK_EVENT_TYPES.stepSucceeded: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);

      next.steps.set(stepId, {
        ...step,
        status: 'succeeded',
        updatedAt: event.occurredAt,
      });

      return next;
    }

    case TASK_EVENT_TYPES.stepFailed: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);

      // Failure category is optional in the event, but if present it must be valid.
      const failureCategory = readOptionalFailureCategory(payload, event);
      const lastErrorMessage = readOptionalString(payload, 'message');

      next.steps.set(stepId, {
        ...step,
        status: 'failed',
        failureCategory,
        lastErrorMessage,
        updatedAt: event.occurredAt,
      });

      return next;
    }

    case TASK_EVENT_TYPES.stepBlocked: {
      const stepId = readRequiredString(payload, 'stepId', event);
      const step = requireExistingStep(next, stepId, event);

      next.steps.set(stepId, {
        ...step,
        status: 'blocked',
        updatedAt: event.occurredAt,
      });

      return next;
    }

    default: {
      // Unknown event types are invalid during F2 Slice 1 replay.
      throw new CraftError(
        CraftErrorCode.TASK_STATE_INVALID,
        `Unknown task event type "${event.type}".`,
        {
          eventId: event.eventId,
          type: event.type,
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Converts unknown event payload into a safe object shape.
 */
function asPayloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CraftError(
      CraftErrorCode.EVENT_MALFORMED,
      'Event payload must be an object when present.',
      { payloadType: typeof payload },
    );
  }

  return payload as Record<string, unknown>;
}

/**
 * Reads a required nonempty string field from an event payload.
 */
function readRequiredString(
  payload: Record<string, unknown>,
  field: string,
  event: StoredTaskEvent,
): string {
  const value = payload[field];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CraftError(
      CraftErrorCode.EVENT_MALFORMED,
      `Event "${event.type}" payload requires nonempty string "${field}".`,
      {
        eventId: event.eventId,
        field,
      },
    );
  }

  return value;
}

/**
 * Reads an optional string field from an event payload.
 */
function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
}

/**
 * Reads an optional failure category from an event payload.
 */
function readOptionalFailureCategory(
  payload: Record<string, unknown>,
  event: StoredTaskEvent,
): FailureCategory | undefined {
  const value = payload.failureCategory;

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isFailureCategory(value)) {
    throw new CraftError(
      CraftErrorCode.EVENT_MALFORMED,
      `Event "${event.type}" payload has invalid failureCategory "${String(value)}".`,
      {
        eventId: event.eventId,
        value,
      },
    );
  }

  return value;
}

/**
 * Type guard for failure categories.
 */
function isFailureCategory(value: unknown): value is FailureCategory {
  return (
    typeof value === 'string' &&
    (FAILURE_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Returns an existing step or throws an invalid-state error.
 */
function requireExistingStep(
  state: TaskRunState,
  stepId: string,
  event: StoredTaskEvent,
): StepRunState {
  const step = state.steps.get(stepId);

  if (!step) {
    throw new CraftError(
      CraftErrorCode.TASK_STATE_INVALID,
      `Event "${event.type}" references unknown step "${stepId}". A step must be queued before it can transition.`,
      {
        eventId: event.eventId,
        stepId,
      },
    );
  }

  return step;
}
