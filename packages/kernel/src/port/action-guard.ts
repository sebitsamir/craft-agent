/**
 * External action guard port.
 *
 * This port exists to enforce the F2 rule:
 * "No duplicate external action."
 *
 * An external action is any action with side effects outside the kernel:
 * - process execution
 * - file mutation outside the artifact store
 * - network request
 * - Git mutation
 * - paid model call
 * - publish/deploy action
 *
 * The caller must reserve the action with an idempotency key before executing
 * the side effect. If the process crashes after the side effect but before
 * completion, restart will see the reservation and must reconcile instead of
 * blindly executing again.
 */

export type ExternalActionStatus = 'reserved' | 'completed' | 'failed';

/**
 * Stored external action execution record.
 */
export interface ExternalActionRecord {
  readonly executionId: string;
  readonly taskId: string;
  readonly stepId?: string;
  readonly idempotencyKey: string;
  readonly status: ExternalActionStatus;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly reservedAt: string;
  readonly completedAt?: string;
}

/**
 * Input for reserving an external action before executing it.
 */
export interface ReserveExternalActionInput {
  readonly taskId: string;
  readonly stepId?: string;
  readonly idempotencyKey: string;
}

/**
 * Input for completing a reserved external action.
 */
export interface CompleteExternalActionInput {
  readonly idempotencyKey: string;
  readonly result?: unknown;
}

/**
 * Input for marking a reserved external action as failed.
 */
export interface FailExternalActionInput {
  readonly idempotencyKey: string;
  readonly error?: unknown;
}

/**
 * Reservation result includes whether the key was already known.
 */
export interface ExternalActionReservation extends ExternalActionRecord {
  readonly alreadyExisted: boolean;
}

/**
 * Action guard abstraction.
 */
export interface ActionGuard {
  reserveExternalAction(input: ReserveExternalActionInput): Promise<ExternalActionReservation>;
  completeExternalAction(input: CompleteExternalActionInput): Promise<ExternalActionRecord>;
  failExternalAction(input: FailExternalActionInput): Promise<ExternalActionRecord>;
}
