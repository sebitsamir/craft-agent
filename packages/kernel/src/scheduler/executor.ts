import { randomUUID } from 'node:crypto';
import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import type { EventStore } from '../port/event-store.js'
import type { ActionGuard } from '../port/action-guard.js'
import { type FailureCategory } from '../failure.js';
import { checkBudget, type BudgetLimits, type BudgetUsage, ZERO_BUDGET_USAGE } from '../budget.js';
import { TASK_EVENT_TYPES } from '../state/task-run.js';
import { calculateRetryDelayMs, shouldRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry.js';
import { CancellationToken } from './cancel.js';

/**
 * Input parameters for executing a single step.
 */
export interface StepExecutionInput {
  readonly taskId: string;
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly limits?: BudgetLimits;
  readonly policy?: RetryPolicy;
  readonly cancelToken?: CancellationToken;
}

/**
 * The result returned by a step's action runner.
 */
export interface StepActionResult {
  readonly success: boolean;
  readonly failureCategory?: FailureCategory;
  readonly errorMessage?: string;
  readonly errorCode?: JunubErrorCode;
  readonly usageDelta?: Partial<BudgetUsage>;
}

/**
 * The actual work function provided by the caller (e.g., a tool adapter).
 */
export type StepActionRunner = (
  input: StepExecutionInput,
  attempt: number
) => Promise<StepActionResult>;

/**
 * Dependencies required by the executor (injected for testability).
 */
export interface StepExecutorDeps {
  readonly eventStore: EventStore;
  readonly actionGuard: ActionGuard;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes a single step with full F2 durability:
 * - Idempotent event logging
 * - External action guarding (no duplicate side effects)
 * - Budget enforcement
 * - Bounded exponential retry for TRANSIENT failures
 * - Clean cancellation handling
 */
export async function executeStep(
  input: StepExecutionInput,
  runner: StepActionRunner,
  deps: StepExecutorDeps
): Promise<void> {
  const { eventStore, actionGuard } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const cancelToken = input.cancelToken ?? new CancellationToken();

  let usage: BudgetUsage = { ...ZERO_BUDGET_USAGE };
  let attempts = 0;

  // 1. Queue the step
  await eventStore.appendTaskEvent({
    taskId: input.taskId,
    eventId: randomUUID(),
    type: TASK_EVENT_TYPES.stepQueued,
    payload: { stepId: input.stepId },
    idempotencyKey: `${input.idempotencyKey}:queued`,
  });

  // 2. Execution Loop
  while (true) {
    // Check for cancellation before starting a new attempt
    if (cancelToken.isCancelled) {
      await eventStore.appendTaskEvent({
        taskId: input.taskId,
        eventId: randomUUID(),
        type: TASK_EVENT_TYPES.stepCancelled,
        payload: { stepId: input.stepId, reason: 'cancel_requested' },
        idempotencyKey: `${input.idempotencyKey}:cancelled`,
      });
      return; // Clean exit, no throw
    }

    attempts += 1;
    usage = { ...usage, retryAttempts: usage.retryAttempts + 1 };

    // 3. Enforce Budget
    try {
      checkBudget(input.limits, usage);
    } catch (err) {
      if (err instanceof JunubError && err.code === JunubErrorCode.BUDGET_EXCEEDED) {
        await eventStore.appendTaskEvent({
          taskId: input.taskId,
          eventId: randomUUID(),
          type: TASK_EVENT_TYPES.stepFailed,
          payload: { stepId: input.stepId, message: err.message, failureCategory: 'MISSING_INPUT' },
          idempotencyKey: `${input.idempotencyKey}:budget_exceeded`,
        });
        throw err;
      }
      throw err;
    }

    // 4. Reserve External Action (Prevents duplicate side effects on crash/retry)
    const attemptKey = `${input.idempotencyKey}:attempt:${attempts}`;
    await actionGuard.reserveExternalAction({
      taskId: input.taskId,
      stepId: input.stepId,
      idempotencyKey: attemptKey,
    });

    let result: StepActionResult;
    try {
      // Emit stepStarted on the very first attempt
      if (attempts === 1) {
         await eventStore.appendTaskEvent({
           taskId: input.taskId,
           eventId: randomUUID(),
           type: TASK_EVENT_TYPES.stepStarted,
           payload: { stepId: input.stepId },
           idempotencyKey: `${input.idempotencyKey}:started`,
         });
      }

      // Execute the actual work
      result = await runner(input, attempts);
    } catch (err) {
      // Unexpected throw -> TERMINAL failure
      result = {
        success: false,
        failureCategory: 'TERMINAL',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    // Accumulate usage reported by the runner
    if (result.usageDelta) {
      usage = {
        ...usage,
        modelCalls: usage.modelCalls + (result.usageDelta.modelCalls ?? 0),
        computeMinutes: usage.computeMinutes + (result.usageDelta.computeMinutes ?? 0),
        cost: usage.cost + (result.usageDelta.cost ?? 0),
        storageBytes: usage.storageBytes + (result.usageDelta.storageBytes ?? 0),
        outputBytes: usage.outputBytes + (result.usageDelta.outputBytes ?? 0),
      };
    }

    // 5. Handle Success
    if (result.success) {
      await actionGuard.completeExternalAction({ idempotencyKey: attemptKey, result: { success: true } });
      await eventStore.appendTaskEvent({
        taskId: input.taskId,
        eventId: randomUUID(),
        type: TASK_EVENT_TYPES.stepSucceeded,
        payload: { stepId: input.stepId },
        idempotencyKey: `${input.idempotencyKey}:succeeded`,
      });
      return;
    }

    // 6. Handle Failure
    const category = result.failureCategory ?? 'TERMINAL';
    await actionGuard.failExternalAction({ idempotencyKey: attemptKey, error: { category, message: result.errorMessage } });

    if (shouldRetry(category, attempts, policy)) {
      const delay = calculateRetryDelayMs(attempts, policy);

      // Log that we are entering retry wait state
      await eventStore.appendTaskEvent({
        taskId: input.taskId,
        eventId: randomUUID(),
        type: TASK_EVENT_TYPES.stepRetryWait,
        payload: { stepId: input.stepId, message: result.errorMessage, failureCategory: category, delayMs: delay },
        idempotencyKey: `${input.idempotencyKey}:retry_wait:${attempts}`,
      });

      await sleep(delay);
      continue; // Loop back to try again
    }

    // Terminal or non-retryable failure
    await eventStore.appendTaskEvent({
      taskId: input.taskId,
      eventId: randomUUID(),
      type: TASK_EVENT_TYPES.stepFailed,
      payload: { stepId: input.stepId, message: result.errorMessage, failureCategory: category },
      idempotencyKey: `${input.idempotencyKey}:failed:final`,
    });

    throw new JunubError(
      result.errorCode ?? JunubErrorCode.TASK_STATE_INVALID,
      `Step ${input.stepId} failed after ${attempts} attempts: ${result.errorMessage}`,
      { category, attempts }
    );
  }
}
