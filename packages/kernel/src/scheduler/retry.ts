import { type FailureCategory, isRetryableFailure } from '../failure.js';

/**
 * Configuration for bounded exponential backoff.
 *
 * The Master Spec strictly prohibits infinite loops. Retries must be bounded
 * by attempts and time, and only applied to idempotent TRANSIENT failures.
 */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/**
 * Sensible defaults for F2 local execution.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
};

/**
 * Calculates the delay before the next retry using exponential backoff with jitter.
 * Jitter prevents thundering herd problems when multiple steps retry simultaneously.
 */
export function calculateRetryDelayMs(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);

  // Add +/- 20% jitter
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Determines if a step should be retried based on its failure category and attempt count.
 *
 * CRITICAL RULE: Only TRANSIENT failures are retryable. FIXABLE, MISSING_INPUT,
 * and TERMINAL failures must fail immediately so the user can inspect the blocker.
 */
export function shouldRetry(
  failureCategory: FailureCategory,
  attempts: number,
  policy: RetryPolicy,
): boolean {
  if (attempts >= policy.maxAttempts) return false;
  return isRetryableFailure(failureCategory);
}
