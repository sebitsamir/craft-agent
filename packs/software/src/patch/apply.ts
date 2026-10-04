/**
 * Patch Applicator
 *
 * Applies a validated patch to the filesystem. Always used under the S2
 * worktree safety gate so uncommitted work is never silently overwritten.
 *
 * The Master Spec (Section 13) requires:
 * "Patches apply to a bounded file set only; out-of-scope paths rejected;
 * before/after snapshots recorded."
 *
 * Layered safety:
 *  1. Validation (model.ts) rejects out-of-scope, absolute, and traversal paths.
 *  2. Apply-time re-check verifies every path against the scope and the
 *     repository root again, even if validation passed (defense in depth).
 *  3. The safety gate (gate.ts) blocks application entirely on a dirty
 *     worktree unless explicit consent is given.
 */

import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { validatePatch, normalizePath, type Patch } from './model.js';
import {
  guardedMutation,
  type WorktreeGateDecision,
  type WorktreeSafetyOptions,
} from '../worktree/gate.js';
import type { WorktreeSnapshot } from '../worktree/snapshot.js';
import type { SnapshotDiff } from '../worktree/diff.js';

/**
 * The result of applying patch operations to the filesystem.
 */
export interface PatchApplyResult {
  readonly patchId: string;
  readonly appliedOperations: number;
  readonly createdPaths: readonly string[];
  readonly updatedPaths: readonly string[];
  readonly deletedPaths: readonly string[];
}

/**
 * The full result of a guarded patch application.
 */
export interface GuardedPatchResult {
  /** Whether the patch passed structural/scope validation. */
  readonly validated: boolean;
  readonly validationErrors: readonly string[];

  /** The safety-gate decision, present once validation passes. */
  readonly decision?: WorktreeGateDecision;

  /** Whether the operations actually ran. */
  readonly applied: boolean;
  readonly applyResult?: PatchApplyResult;

  /** Before/after snapshots and their diff, present when the gate allowed. */
  readonly before?: WorktreeSnapshot;
  readonly after?: WorktreeSnapshot;
  readonly diff?: SnapshotDiff;
}

/**
 * Applies patch operations to the filesystem.
 *
 * Low-level: assumes the patch is already validated, but still performs
 * apply-time scope and root-escape re-checks and enforces per-kind
 * existence preconditions.
 *
 * Prefer guardedApplyPatch, which wraps this in validation + the safety gate.
 *
 * @param root   The repository root.
 * @param patch  A validated patch to apply.
 * @returns      A summary of what was applied.
 */
export async function applyPatchOperations(
  root: string,
  patch: Patch,
): Promise<PatchApplyResult> {
  const allowedSet = new Set(patch.allowedPaths.map((p) => normalizePath(p)));
  const createdPaths: string[] = [];
  const updatedPaths: string[] = [];
  const deletedPaths: string[] = [];

  for (const op of patch.operations) {
    const normalized = normalizePath(op.path);

    // Apply-time scope re-check (defense in depth).
    if (!allowedSet.has(normalized)) {
      throw new Error(
        `Operation path "${op.path}" is outside the declared allowedPaths scope.`,
      );
    }

    // Resolve the target and confirm it stays inside the repository root.
    const targetPath = resolveWithinRoot(root, normalized);

    switch (op.kind) {
      case 'create': {
        if (await exists(targetPath)) {
          throw new Error(`Cannot create "${op.path}": file already exists.`);
        }
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, op.content ?? '', 'utf8');
        createdPaths.push(normalized);
        break;
      }

      case 'update': {
        if (!(await exists(targetPath))) {
          throw new Error(`Cannot update "${op.path}": file does not exist.`);
        }
        await writeFile(targetPath, op.content ?? '', 'utf8');
        updatedPaths.push(normalized);
        break;
      }

      case 'delete': {
        if (!(await exists(targetPath))) {
          throw new Error(`Cannot delete "${op.path}": file does not exist.`);
        }
        await unlink(targetPath);
        deletedPaths.push(normalized);
        break;
      }

      default: {
        // Unreachable for a validated patch, but keep the guard explicit.
        throw new Error('Unknown patch operation kind.');
      }
    }
  }

  return {
    patchId: patch.patchId,
    appliedOperations: patch.operations.length,
    createdPaths,
    updatedPaths,
    deletedPaths,
  };
}

/**
 * Validates a patch and applies it under the worktree safety gate.
 *
 * Flow:
 *  1. Validate the patch. If invalid, return without touching the filesystem.
 *  2. Hand off to guardedMutation: before-snapshot -> gate -> apply ->
 *     after-snapshot -> diff.
 *
 * @param root     The repository root.
 * @param patch    The patch to apply (typically parsed JSON).
 * @param options  Safety overrides such as allowDirty.
 * @returns        A full record of validation, gate decision, application, and diff.
 */
export async function guardedApplyPatch(
  root: string,
  patch: unknown,
  options: WorktreeSafetyOptions = {},
): Promise<GuardedPatchResult> {
  // 1. Validate first. An invalid patch never reaches the filesystem.
  const validation = validatePatch(patch);
  if (!validation.valid) {
    return {
      validated: false,
      validationErrors: validation.errors,
      applied: false,
    };
  }

  const validPatch = patch as Patch;

  // 2. Apply under the safety gate.
  const gate = await guardedMutation(
    root,
    () => applyPatchOperations(root, validPatch),
    options,
  );

  return {
    validated: true,
    validationErrors: [],
    decision: gate.decision,
    applied: gate.applied,
    applyResult: gate.result,
    before: gate.before,
    after: gate.after,
    diff: gate.diff,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a relative path within root, rejecting any escape.
 */
function resolveWithinRoot(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  const rel = relative(resolvedRoot, target);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${relativePath}" escapes the repository root.`);
  }

  return target;
}

/**
 * Returns true when a file exists.
 */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
