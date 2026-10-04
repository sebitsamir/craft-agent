import type { WorktreeSnapshot } from './snapshot.js';

/**
 * Snapshot Diff
 *
 * Compares two WorktreeSnapshots of the same repository taken at different
 * times and produces a structured report of what changed between them.
 *
 * This is the analytical half of the S2 safety gate: after any operation,
 * the engine captures an "after" snapshot and diffs it against the "before"
 * snapshot to prove exactly what happened — and to surface any uncommitted
 * artifacts that were created or lost.
 *
 * The Master Spec (Section 12) requires:
 * "Repository status captured before and after ... uncommitted artifacts reported."
 *
 * Design principles:
 * - Pure. No filesystem or git access; it only compares two snapshots.
 * - Deterministic. Same inputs always produce the same diff.
 * - Explicit. Every category of change is named and enumerable.
 */

/**
 * Structured comparison of two worktree snapshots.
 */
export interface SnapshotDiff {
  readonly schemaVersion: 1;

  /** Root both snapshots share. */
  readonly root: string;

  /** Timestamps of the two snapshots (informational). */
  readonly beforeCapturedAt: string;
  readonly afterCapturedAt: string;

  /** True when the branch name changed between snapshots. */
  readonly branchMoved: boolean;

  /** True when the HEAD commit changed between snapshots. */
  readonly headMoved: boolean;
  readonly beforeHead?: string;
  readonly afterHead?: string;

  /** Tracked paths that are dirty after but were not dirty before. */
  readonly newlyModifiedPaths: readonly string[];

  /** Tracked paths that were dirty before but are no longer dirty after. */
  readonly resolvedPaths: readonly string[];

  /** Untracked paths that exist after but did not exist before. */
  readonly newUntrackedPaths: readonly string[];

  /** Untracked paths that existed before but are gone after. */
  readonly goneUntrackedPaths: readonly string[];

  /** True when nothing observable changed between the two snapshots. */
  readonly identical: boolean;
}

/**
 * Compares a before-snapshot to an after-snapshot.
 *
 * @param before  Snapshot taken prior to an operation.
 * @param after   Snapshot taken after the operation.
 * @returns       A structured diff describing every observable change.
 * @throws        When the snapshots come from different repository roots.
 */
export function diffSnapshots(
  before: WorktreeSnapshot,
  after: WorktreeSnapshot,
): SnapshotDiff {
  // Safety: diffing snapshots from different repositories is a caller bug.
  if (before.root !== after.root) {
    throw new Error(
      `Cannot diff snapshots from different roots: "${before.root}" vs "${after.root}"`,
    );
  }

  // Build sets for fast membership tests.
  const beforeChanged = new Set(before.changedPaths);
  const afterChanged = new Set(after.changedPaths);
  const beforeUntracked = new Set(before.untrackedPaths);
  const afterUntracked = new Set(after.untrackedPaths);

  // Tracked changes: what became dirty, and what got resolved.
  const newlyModifiedPaths = [...afterChanged].filter((p) => !beforeChanged.has(p));
  const resolvedPaths = [...beforeChanged].filter((p) => !afterChanged.has(p));

  // Untracked artifacts: what appeared, and what disappeared.
  const newUntrackedPaths = [...afterUntracked].filter((p) => !beforeUntracked.has(p));
  const goneUntrackedPaths = [...beforeUntracked].filter((p) => !afterUntracked.has(p));

  const branchMoved = before.branch !== after.branch;
  const headMoved = before.headCommit !== after.headCommit;

  // Identical means no observable change of any kind. Deliberately ignores
  // capturedAt, since two snapshots always have different timestamps.
  const identical =
    !branchMoved &&
    !headMoved &&
    newlyModifiedPaths.length === 0 &&
    resolvedPaths.length === 0 &&
    newUntrackedPaths.length === 0 &&
    goneUntrackedPaths.length === 0;

  return {
    schemaVersion: 1,
    root: before.root,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    branchMoved,
    headMoved,
    beforeHead: before.headCommit,
    afterHead: after.headCommit,
    newlyModifiedPaths,
    resolvedPaths,
    newUntrackedPaths,
    goneUntrackedPaths,
    identical,
  };
}
