import { JunubErrorCode } from "../contracts/src/errors.js";
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
];
/**
 * Returns true only for failures that may be retried automatically.
 *
 * Important:
 * - TRANSIENT retries are only allowed for idempotent operations.
 * - FIXABLE failures should usually trigger a changed plan, not blind retry.
 */
export function isRetryableFailure(category) {
    return category === 'TRANSIENT';
}
/**
 * Maps stable contract error codes to a failure category.
 *
 * This keeps the scheduler deterministic. It does not guess from message text.
 */
export function classifyErrorCode(code) {
    switch (code) {
        // Capability/domain availability problems are unsupported-work problems.
        case JunubErrorCode.CAPABILITY_NOT_FOUND:
        case JunubErrorCode.CAPABILITY_UNAVAILABLE:
        case JunubErrorCode.CAPABILITY_PLANNED:
        case JunubErrorCode.CAPABILITY_RESTRICTED:
            return 'UNSUPPORTED';
        // Policy/governance problems must not be retried blindly.
        case JunubErrorCode.MISSING_REVIEWER_ROLE:
        case JunubErrorCode.PROTOCOL_VERSION_UNSUPPORTED:
        case JunubErrorCode.SCHEMA_VERSION_UNSUPPORTED:
            return 'POLICY_BLOCKED';
        // Validation failures are usually fixable by changing the input/plan.
        case JunubErrorCode.MALFORMED_TASK_CONTRACT:
        case JunubErrorCode.DUPLICATE_CRITERION_ID:
        case JunubErrorCode.INVALID_TASK_VERSION:
        case JunubErrorCode.CRITERION_REMOVAL_DISALLOWED:
        case JunubErrorCode.INVALID_BUDGET:
        case JunubErrorCode.INVALID_DEADLINE:
        case JunubErrorCode.INVALID_POLICY_VERSION:
        case JunubErrorCode.MALFORMED_ARTIFACT:
        case JunubErrorCode.MALFORMED_EVIDENCE:
        case JunubErrorCode.ARTIFACT_VERSION_MISMATCH:
        case JunubErrorCode.EVIDENCE_UNBOUND_CRITERION:
        case JunubErrorCode.EVIDENCE_UNBOUND_ARTIFACT:
        case JunubErrorCode.EVIDENCE_HASH_MISMATCH:
            return 'FIXABLE';
        // Protocol/state corruption is terminal until a human/system inspects it.
        case JunubErrorCode.PROTOCOL_MALFORMED:
        case JunubErrorCode.PROTOCOL_SEQUENCE_INVALID:
        case JunubErrorCode.EVENT_MALFORMED:
        case JunubErrorCode.EVENT_SEQUENCE_INVALID:
        case JunubErrorCode.TASK_STATE_INVALID:
        case JunubErrorCode.EXTERNAL_ACTION_CONFLICT:
        case JunubErrorCode.STORAGE_MIGRATION_FAILED:
            return 'TERMINAL';
        // Budget exhaustion is a controlled stop, not a transient retry.
        case JunubErrorCode.BUDGET_EXCEEDED:
            return 'MISSING_INPUT';
        // Missing blobs can be user-restorable or storage-corruption related.
        case JunubErrorCode.ARTIFACT_BLOB_MISSING:
        case JunubErrorCode.ARTIFACT_HASH_MISMATCH:
            return 'EXTERNAL_STATE_UNKNOWN';
        default:
            // Unknown error codes must be treated conservatively.
            return 'TERMINAL';
    }
}
//# sourceMappingURL=failure.js.map