import { CraftErrorCode } from "../contracts/src/errors.js";
/**
 * F2 failure taxonomy.
 *
 * The Master Specification requires that failures are classified so the
 * scheduler can decide whether retry is safe, whether input is missing,
 * whether policy blocked the action, or whether the task must stop.
 */
export const FAILURE_CATEGORIES = [
  // Temporary infrastructure failure: rate limit, network blip, process restart.
  'TRANSIENT',

  // The work failed validation/test, but a new attempt with changed input may fix it.
  'FIXABLE',

  // The task cannot continue until a user or upstream system supplies input.
  'MISSING_INPUT',

  // Kernel policy, permission rules, or governance blocked the action.
  'POLICY_BLOCKED',

  // The requested capability/domain/action is not supported yet.
  'UNSUPPORTED',

  // An external side effect occurred but its final state is unknown.
  // This must be reconciled before retrying.
  'EXTERNAL_STATE_UNKNOWN',

  // The task cannot be recovered by retrying the same action.
  'TERMINAL',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * Returns true only for failures that may be retried automatically.
 *
 * Important:
 * - TRANSIENT retries are only allowed for idempotent operations.
 * - FIXABLE failures should usually trigger a changed plan, not blind retry.
 */
export function isRetryableFailure(category: FailureCategory): boolean {
  return category === 'TRANSIENT';
}

/**
 * Maps stable contract error codes to a failure category.
 *
 * This keeps the scheduler deterministic. It does not guess from message text.
 */
export function classifyErrorCode(code: CraftErrorCode): FailureCategory {
  switch (code) {
    // Capability/domain availability problems are unsupported-work problems.
    case CraftErrorCode.CAPABILITY_NOT_FOUND:
    case CraftErrorCode.CAPABILITY_UNAVAILABLE:
    case CraftErrorCode.CAPABILITY_PLANNED:
    case CraftErrorCode.CAPABILITY_RESTRICTED:
      return 'UNSUPPORTED';

    // Policy/governance problems must not be retried blindly.
    case CraftErrorCode.MISSING_REVIEWER_ROLE:
    case CraftErrorCode.PROTOCOL_VERSION_UNSUPPORTED:
    case CraftErrorCode.SCHEMA_VERSION_UNSUPPORTED:
      return 'POLICY_BLOCKED';

    // Validation failures are usually fixable by changing the input/plan.
    case CraftErrorCode.MALFORMED_TASK_CONTRACT:
    case CraftErrorCode.DUPLICATE_CRITERION_ID:
    case CraftErrorCode.INVALID_TASK_VERSION:
    case CraftErrorCode.CRITERION_REMOVAL_DISALLOWED:
    case CraftErrorCode.INVALID_BUDGET:
    case CraftErrorCode.INVALID_DEADLINE:
    case CraftErrorCode.INVALID_POLICY_VERSION:
    case CraftErrorCode.MALFORMED_ARTIFACT:
    case CraftErrorCode.MALFORMED_EVIDENCE:
    case CraftErrorCode.ARTIFACT_VERSION_MISMATCH:
    case CraftErrorCode.EVIDENCE_UNBOUND_CRITERION:
    case CraftErrorCode.EVIDENCE_UNBOUND_ARTIFACT:
    case CraftErrorCode.EVIDENCE_HASH_MISMATCH:
      return 'FIXABLE';

    // Protocol/state corruption is terminal until a human/system inspects it.
    case CraftErrorCode.PROTOCOL_MALFORMED:
    case CraftErrorCode.PROTOCOL_SEQUENCE_INVALID:
    case CraftErrorCode.EVENT_MALFORMED:
    case CraftErrorCode.EVENT_SEQUENCE_INVALID:
    case CraftErrorCode.TASK_STATE_INVALID:
    case CraftErrorCode.EXTERNAL_ACTION_CONFLICT:
    case CraftErrorCode.STORAGE_MIGRATION_FAILED:
      return 'TERMINAL';

    // Budget exhaustion is a controlled stop, not a transient retry.
    case CraftErrorCode.BUDGET_EXCEEDED:
      return 'MISSING_INPUT';

    // Missing blobs can be user-restorable or storage-corruption related.
    case CraftErrorCode.ARTIFACT_BLOB_MISSING:
    case CraftErrorCode.ARTIFACT_HASH_MISMATCH:
      return 'EXTERNAL_STATE_UNKNOWN';

    default:
      // Unknown error codes must be treated conservatively.
      return 'TERMINAL';
  }
}
