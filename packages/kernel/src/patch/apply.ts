/**
 * Patch Applicator
 *
 * Applies a validated patch to the filesystem. Always used under the S2
 * worktree safety gate so uncommitted work is never silently overwritten.
 *
 * Layered safety:
 *  1. Validation (model.ts) rejects out-of-scope, absolute, and traversal paths.
 *  2. Apply-time re-check verifies every path against the scope and the
 *     repository root again (defense in depth).
 *  3. The safety gate (gate.ts) blocks application on a dirty worktree
 *     unless explicit consent is given.
 */

import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { validatePatch, normalizePath, type Patch, type PatchOperation } from './model.js';
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
 * Optional hooks invoked around each operation. Used by the artifact
 * recorder to capture content hashes before and after each change.
 */
export interface PatchOperationHooks {
  beforeOperation?(op: PatchOperation, targetPath: string): Promise<void> | void;
  afterOperation?(op: PatchOperation, targetPath: string): Promise<void> | void;
}

/**
 * The full result of a guarded patch application.
 */
export interface GuardedPatchResult {
  readonly validated: boolean;
  readonly validationErrors: readonly string[];
  readonly decision?: WorktreeGateDecision;
  readonly applied: boolean;
  readonly applyResult?: PatchApplyResult;
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
 * @param root   The repository root.
 * @param patch  A validated patch to apply.
 * @param hooks  Optional before/after observers (used for artifact hashing).
 * @returns      A summary of what was applied.
 */
export async function applyPatchOperations(
  root: string,
  patch: Patch,
  hooks?: PatchOperationHooks,
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

    // Let observers capture pre-change state.
    await hooks?.beforeOperation?.(op, targetPath);

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
        throw new Error('Unknown patch operation kind.');
      }
    }

    // Let observers capture post-change state.
    await hooks?.afterOperation?.(op, targetPath);
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
 */
export async function guardedApplyPatch(
  root: string,
  patch: unknown,
  options: WorktreeSafetyOptions = {},
): Promise<GuardedPatchResult> {
  const validation = validatePatch(patch);
  if (!validation.valid) {
    return { validated: false, validationErrors: validation.errors, applied: false };
  }

  const validPatch = patch as Patch;

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

function resolveWithinRoot(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  const rel = relative(resolvedRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${relativePath}" escapes the repository root.`);
  }
  return target;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
