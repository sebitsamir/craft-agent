import { captureWorktreeSnapshot, type WorktreeSnapshot } from './snapshot.js';
import { diffSnapshots, type SnapshotDiff } from './diff.js';

/**
 * Worktree Safety Gate
 *
 * The decision layer that sits between intent and mutation. Before Craft
 * Agent changes any file, it must pass through this gate. The gate inspects
 * the current worktree and decides whether proceeding would overwrite
 * uncommitted work.
 *
 * The Master Spec (Section 12) requires:
 * "Clean path applies without overwrite; dirty path preserves work;
 * uncommitted artifacts reported."
 *
 * Decision model:
 * - clean   -> the worktree has no uncommitted work; mutation may proceed.
 * - dirty   -> uncommitted work exists; block by default to preserve it.
 *              The caller may explicitly consent via allowDirty.
 * - non-git -> no Git-tracked work to protect; mutation may proceed, but the
 *              decision is explicit about the absence of a Git safety net.
 */

/**
 * The outcome of a safety evaluation.
 */
export interface WorktreeGateDecision {
  /** Whether the gate permits the mutation to proceed. */
  readonly allowed: boolean;

  /** Which path the decision took. */
  readonly path: 'clean' | 'dirty' | 'non-git';

  /** Human-readable explanation suitable for surfacing to the user. */
  readonly reason: string;

  /** Paths that would be at risk if the mutation proceeded on a dirty tree. */
  readonly atRiskPaths: readonly string[];
}

/**
 * Options for safety evaluation.
 */
export interface WorktreeSafetyOptions {
  /**
   * Explicit consent to proceed even on a dirty worktree. Use sparingly and
   * only when the caller has already preserved the work (e.g. via a stash or
   * a dedicated branch).
   */
  readonly allowDirty?: boolean;
}

/**
 * Evaluates whether a mutation is safe for the given worktree snapshot.
 *
 * @param snapshot  A captured worktree snapshot (the "before" record).
 * @param options   Optional overrides such as allowDirty.
 * @returns         A decision describing whether the mutation may proceed.
 */
export function evaluateWorktreeSafety(
  snapshot: WorktreeSnapshot,
  options: WorktreeSafetyOptions = {},
): WorktreeGateDecision {
  // Non-Git directories have no Git-tracked work to preserve. We allow the
  // mutation but are explicit that no Git safety net exists.
  if (!snapshot.isGitRepository) {
    return {
      allowed: true,
      path: 'non-git',
      reason: 'Not a Git repository; no Git-tracked work to preserve.',
      atRiskPaths: [],
    };
  }

  // Everything currently uncommitted is at risk during a mutation.
  const atRiskPaths = [...snapshot.changedPaths, ...snapshot.untrackedPaths];

  // Clean path: no uncommitted work, safe to apply.
  if (!snapshot.isDirty) {
    return {
      allowed: true,
      path: 'clean',
      reason: 'Worktree is clean; changes can be applied without overwriting uncommitted work.',
      atRiskPaths: [],
    };
  }

  // Dirty path with explicit consent: proceed but report what is at risk.
  if (options.allowDirty) {
    return {
      allowed: true,
      path: 'dirty',
      reason: 'Worktree is dirty but the caller explicitly consented to proceed.',
      atRiskPaths,
    };
  }

  // Dirty path default: block to preserve uncommitted work.
  return {
    allowed: false,
    path: 'dirty',
    reason:
      'Worktree has uncommitted changes or untracked files; refusing to overwrite. ' +
      'Commit or stash your work, or pass allowDirty to proceed explicitly.',
    atRiskPaths,
  };
}

/**
 * The result of a guarded mutation.
 *
 * @typeParam T  The return type of the mutation function.
 */
export interface GuardedMutationResult<T> {
  /** The safety decision that governed this operation. */
  readonly decision: WorktreeGateDecision;

  /** Whether the mutation actually ran. False when the gate blocked it. */
  readonly applied: boolean;

  /** The mutation's return value, present only when applied. */
  readonly result?: T;

  /** The "before" snapshot, always present. */
  readonly before: WorktreeSnapshot;

  /** The "after" snapshot, present only when the mutation ran. */
  readonly after?: WorktreeSnapshot;

  /** Before/after diff, present only when the mutation ran. */
  readonly diff?: SnapshotDiff;
}

/**
 * Runs a mutation under the worktree safety gate.
 *
 * Sequence:
 *  1. Capture the "before" snapshot.
 *  2. Evaluate the safety gate.
 *  3. If blocked, return without running the mutation (work is preserved).
 *  4. If allowed, run the mutation, capture the "after" snapshot, and diff.
 *
 * @param root     The repository root to operate on.
 * @param mutate   The mutation to run if the gate allows it.
 * @param options  Optional safety overrides such as allowDirty.
 * @returns        A full record of the decision, application, and diff.
 */
export async function guardedMutation<T>(
  root: string,
  mutate: () => Promise<T>,
  options: WorktreeSafetyOptions = {},
): Promise<GuardedMutationResult<T>> {
  // 1. Capture the before state.
  const before = await captureWorktreeSnapshot(root);

  // 2. Evaluate the gate.
  const decision = evaluateWorktreeSafety(before, options);

  // 3. Blocked path: do not run the mutation. Uncommitted work is preserved.
  if (!decision.allowed) {
    return { decision, applied: false, before };
  }

  // 4. Allowed path: run the mutation, then capture and diff the result.
  // If mutate() throws, the error propagates; S3 will add richer failure capture.
  const result = await mutate();
  const after = await captureWorktreeSnapshot(root);
  const diff = diffSnapshots(before, after);

  return { decision, applied: true, result, before, after, diff };
}
