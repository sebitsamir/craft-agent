import { JunubErrorCode } from "../../contracts/src/errors.ts";
/**
 * F2 failure taxonomy.
 *
 * The Master Specification requires that failures are classified so the
 * scheduler can decide whether retry is safe, whether input is missing,
 * whether policy blocked the action, or whether the task must stop.
 */
export declare const FAILURE_CATEGORIES: readonly ["TRANSIENT", "FIXABLE", "MISSING_INPUT", "POLICY_BLOCKED", "UNSUPPORTED", "EXTERNAL_STATE_UNKNOWN", "TERMINAL"];
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];
/**
 * Returns true only for failures that may be retried automatically.
 *
 * Important:
 * - TRANSIENT retries are only allowed for idempotent operations.
 * - FIXABLE failures should usually trigger a changed plan, not blind retry.
 */
export declare function isRetryableFailure(category: FailureCategory): boolean;
/**
 * Maps stable contract error codes to a failure category.
 *
 * This keeps the scheduler deterministic. It does not guess from message text.
 */
export declare function classifyErrorCode(code: JunubErrorCode): FailureCategory;
//# sourceMappingURL=failure.d.ts.map
