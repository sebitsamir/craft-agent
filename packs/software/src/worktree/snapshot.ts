import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { run } from '../process.js';

/**
 * Worktree Snapshot
 *
 * An immutable, point-in-time capture of a Git worktree's state. This is the
 * "before" record that every mutating operation in Phase S3 must take before
 * touching a single file.
 *
 * The Master Spec (Section 12) requires:
 * "Repository status captured before and after; clean path applies without
 * overwrite; dirty path preserves work; uncommitted artifacts reported."
 *
 * Design principles:
 * - Read-only. This module never modifies the worktree.
 * - Bounded. Every git call uses timeouts and output caps via run().
 * - Explicit. Clean vs dirty is derived from real git output, never guessed.
 * - Complete. Untracked files are reported separately because they are the
 *   most commonly destroyed artifacts during careless operations.
 */

/**
 * A point-in-time capture of a Git worktree.
 */
export interface WorktreeSnapshot {
  readonly schemaVersion: 1;

  /** Absolute path to the worktree root. */
  readonly root: string;

  /** ISO timestamp of when this snapshot was captured. */
  readonly capturedAt: string;

  /** Whether the target is inside a Git work tree. */
  readonly isGitRepository: boolean;

  /** Current branch name, when available. */
  readonly branch?: string;

  /** Full SHA of HEAD, when available. */
  readonly headCommit?: string;

  /**
   * True when there are uncommitted tracked changes OR untracked files.
   * Callers should inspect changedPaths/untrackedPaths to decide policy.
   */
  readonly isDirty: boolean;

  /** Tracked files that have been modified/added/deleted/renamed. */
  readonly changedPaths: readonly string[];

  /** Files present on disk but not tracked by Git. */
  readonly untrackedPaths: readonly string[];
}

/**
 * Captures a WorktreeSnapshot for the given directory.
 *
 * @param input  Directory to snapshot. Defaults to the current directory.
 * @returns      An immutable snapshot of the worktree state.
 * @throws       When the target is not a directory.
 */
export async function captureWorktreeSnapshot(
  input: string = '.',
): Promise<WorktreeSnapshot> {
  const root = resolve(input);

  if (!(await stat(root)).isDirectory()) {
    throw new Error('Target must be a directory');
  }

  const capturedAt = new Date().toISOString();

  // 1. Probe whether we are inside a Git work tree.
  const probe = await run(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    root,
    { timeoutMs: 10_000, maxOutputBytes: 4_096 },
  );
  const isGit =
    probe.exitCode === 0 &&
    !probe.timedOut &&
    !probe.error &&
    probe.stdout.trim() === 'true';

  // Non-Git targets produce a valid but empty snapshot. Callers can decide
  // whether that is acceptable for their operation.
  if (!isGit) {
    return {
      schemaVersion: 1,
      root,
      capturedAt,
      isGitRepository: false,
      isDirty: false,
      changedPaths: [],
      untrackedPaths: [],
    };
  }

  // 2. Resolve the current branch name.
  const branchRes = await run(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    root,
    { timeoutMs: 10_000, maxOutputBytes: 4_096 },
  );
  const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : undefined;

  // 3. Resolve the HEAD commit SHA.
  const headRes = await run(
    'git',
    ['rev-parse', 'HEAD'],
    root,
    { timeoutMs: 10_000, maxOutputBytes: 4_096 },
  );
  const headCommit = headRes.exitCode === 0 ? headRes.stdout.trim() : undefined;

  // 4. Capture porcelain status, including all untracked files.
  const statusRes = await run(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'],
    root,
    { timeoutMs: 10_000, maxOutputBytes: 1_048_576 },
  );

  const { changedPaths, untrackedPaths } = parseStatus(statusRes.stdout);

  return {
    schemaVersion: 1,
    root,
    capturedAt,
    isGitRepository: true,
    branch,
    headCommit,
    isDirty: changedPaths.length > 0 || untrackedPaths.length > 0,
    changedPaths,
    untrackedPaths,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses `git status --porcelain=v1 -z` output into changed and untracked lists.
 *
 * Porcelain v1 with -z emits NUL-separated entries of the form `XY PATH`.
 * - `??` marks untracked files.
 * - Any other code (M, A, D, R, C, ...) marks a tracked change.
 * - Rename/copy entries are followed by the original path, which we also record.
 */
function parseStatus(output: string): {
  changedPaths: string[];
  untrackedPaths: string[];
} {
  const changedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  const entries = output.split('\0');

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    const statusCode = entry.slice(0, 2);
    const path = entry.slice(3);

    if (statusCode === '??') {
      untrackedPaths.push(path);
    } else {
      changedPaths.push(path);
    }

    // Rename/copy entries carry a second path (the source). Record it too so
    // nothing about the change is hidden from the safety gate.
    if (/R|C/.test(statusCode)) {
      const original = entries[++i];
      if (original) changedPaths.push(original);
    }
  }

  return { changedPaths, untrackedPaths };
}
