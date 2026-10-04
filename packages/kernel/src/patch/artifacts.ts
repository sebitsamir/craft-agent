/**
 * Patch Artifact Recording
 *
 * The Master Spec (Section 13) requires:
 * "Resulting artifacts hash-bound and reported."
 *
 * This module wraps the guarded patch flow and produces a PatchReport in
 * which every created, updated, or deleted file is a verifiable artifact
 * record bound to its SHA-256 content hash.
 *
 * Hashes are captured during the apply loop via hooks:
 * - beforeOperation records the prior content hash for update/delete.
 * - afterOperation records the resulting content hash for create/update.
 * This matters for delete, because the file no longer exists afterward.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validatePatch, type Patch } from './model.js';
import {
  applyPatchOperations,
  type PatchOperationHooks,
} from './apply.js';
import { evaluateWorktreeSafety, type WorktreeGateDecision, type WorktreeSafetyOptions } from '../worktree/gate.js';
import { captureWorktreeSnapshot, type WorktreeSnapshot } from '../worktree/snapshot.js';
import { diffSnapshots, type SnapshotDiff } from '../worktree/diff.js';

/**
 * A single hash-bound artifact produced by a patch.
 */
export interface PatchArtifactRecord {
  /** Repository-relative path of the affected file. */
  readonly path: string;

  /** What happened to the file. */
  readonly operation: 'created' | 'updated' | 'deleted';

  /** SHA-256 of the resulting content. Null for deleted files. */
  readonly sha256: string | null;

  /** Byte length of the resulting content. Zero for deleted files. */
  readonly sizeBytes: number;

  /** SHA-256 of the prior content, present for updated and deleted files. */
  readonly previousSha256?: string;
}

/**
 * The complete, verifiable record of a patch application.
 */
export interface PatchReport {
  readonly schemaVersion: 1;
  readonly patchId: string;
  readonly root: string;
  readonly appliedAt: string;

  readonly validated: boolean;
  readonly validationErrors: readonly string[];

  readonly decision?: WorktreeGateDecision;
  readonly applied: boolean;

  /** Hash-bound artifact records for every affected file. */
  readonly artifacts: readonly PatchArtifactRecord[];

  readonly before?: WorktreeSnapshot;
  readonly after?: WorktreeSnapshot;
  readonly diff?: SnapshotDiff;
}

/**
 * Validates a patch, applies it under the safety gate, and records
 * hash-bound artifacts for every affected file.
 *
 * @param root     The repository root.
 * @param patch    The patch to apply (typically parsed JSON).
 * @param options  Safety overrides such as allowDirty.
 * @returns        A full, verifiable PatchReport.
 */
export async function applyPatchWithReport(
  root: string,
  patch: unknown,
  options: WorktreeSafetyOptions = {},
): Promise<PatchReport> {
  const appliedAt = new Date().toISOString();

  // 1. Validate. An invalid patch never reaches the filesystem.
  const validation = validatePatch(patch);
  if (!validation.valid) {
    const maybeId = (patch as Record<string, unknown> | null)?.patchId;
    return {
      schemaVersion: 1,
      patchId: typeof maybeId === 'string' ? maybeId : 'unknown',
      root,
      appliedAt,
      validated: false,
      validationErrors: validation.errors,
      applied: false,
      artifacts: [],
    };
  }

  const validPatch = patch as Patch;

  // 2. Before-snapshot and safety gate.
  const before = await captureWorktreeSnapshot(root);
  const decision = evaluateWorktreeSafety(before, options);
  if (!decision.allowed) {
    return {
      schemaVersion: 1,
      patchId: validPatch.patchId,
      root,
      appliedAt,
      validated: true,
      validationErrors: [],
      decision,
      applied: false,
      artifacts: [],
      before,
    };
  }

  // 3. Apply with artifact-collection hooks.
  const artifacts: PatchArtifactRecord[] = [];
  const previousHashes = new Map<string, string>();

  const hooks: PatchOperationHooks = {
    async beforeOperation(op, targetPath) {
      // Capture prior content for update and delete before it changes.
      if (op.kind === 'update' || op.kind === 'delete') {
        const content = await readFile(targetPath);
        previousHashes.set(op.path, sha256Of(content));
      }
    },
    async afterOperation(op, targetPath) {
      if (op.kind === 'create' || op.kind === 'update') {
        const content = await readFile(targetPath);
        artifacts.push({
          path: op.path,
          operation: op.kind === 'create' ? 'created' : 'updated',
          sha256: sha256Of(content),
          sizeBytes: content.byteLength,
          previousSha256: previousHashes.get(op.path),
        });
      } else if (op.kind === 'delete') {
        artifacts.push({
          path: op.path,
          operation: 'deleted',
          sha256: null,
          sizeBytes: 0,
          previousSha256: previousHashes.get(op.path),
        });
      }
    },
  };

  await applyPatchOperations(root, validPatch, hooks);

  // 4. After-snapshot and diff.
  const after = await captureWorktreeSnapshot(root);
  const diff = diffSnapshots(before, after);

  return {
    schemaVersion: 1,
    patchId: validPatch.patchId,
    root,
    appliedAt,
    validated: true,
    validationErrors: [],
    decision,
    applied: true,
    artifacts,
    before,
    after,
    diff,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256Of(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
