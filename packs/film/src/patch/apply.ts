import {
  validatePatch,
  applyPatchWithReport,
  normalizePath,
  type Patch,
  type PatchArtifactRecord,
  type WorktreeSnapshot,
  type SnapshotDiff,
  type WorktreeSafetyOptions,
} from '@junub-agent/kernel';
import { mapFilmProject, isMediaAssetPath } from '../project.js';
import { verifyMediaLinks } from '../checks/verify.js';

/**
 * Film Scoped Patch Applicator
 *
 * Wraps the kernel's gate + hash-bound patch machinery with a film-specific
 * safety rule: media assets are immutable. A patch may edit timelines and
 * scripts, but any operation targeting a media file (existing or new, by
 * path or by extension) is rejected before anything touches disk.
 *
 * After a successful apply, media links are re-verified so a patch that
 * breaks a timeline's references is reported immediately.
 */

export interface FilmPatchReport {
  readonly schemaVersion: 1;
  readonly patchId: string;
  readonly root: string;
  readonly appliedAt: string;

  /** True when the patch tried to touch protected media assets. */
  readonly scopeViolation: boolean;
  readonly scopeViolations: readonly string[];

  readonly applied: boolean;
  readonly artifacts: readonly PatchArtifactRecord[];

  /** Media-link health after the patch. Null when nothing was applied. */
  readonly mediaLinksPassed: boolean | null;
  readonly missingMedia: readonly string[];

  readonly before?: WorktreeSnapshot;
  readonly after?: WorktreeSnapshot;
  readonly diff?: SnapshotDiff;
}

/**
 * Applies a scoped patch to a film project under the kernel safety gate,
 * enforcing film-specific media immutability and re-verifying media links.
 *
 * @param root     The film project root.
 * @param patch    The patch to apply (typically parsed JSON).
 * @param options  Safety overrides such as allowDirty.
 * @returns        A FilmPatchReport describing scope, application, and media health.
 */
export async function applyFilmPatch(
  root: string,
  patch: unknown,
  options: WorktreeSafetyOptions = {},
): Promise<FilmPatchReport> {
  const appliedAt = new Date().toISOString();

  // 1. Structural validation (kernel).
  const validation = validatePatch(patch);
  if (!validation.valid) {
    const maybeId = (patch as Record<string, unknown> | null)?.patchId;
    return {
      schemaVersion: 1,
      patchId: typeof maybeId === 'string' ? maybeId : 'unknown',
      root,
      appliedAt,
      scopeViolation: false,
      scopeViolations: [],
      applied: false,
      artifacts: [],
      mediaLinksPassed: null,
      missingMedia: [],
    };
  }
  const validPatch = patch as Patch;

  // 2. Film-specific scope rule: media assets are immutable.
  const project = mapFilmProject(root);
  const mediaSet = new Set(project.mediaAssets.map((p) => normalizePath(p)));
  const scopeViolations = validPatch.operations
    .map((op) => normalizePath(op.path))
    .filter((p) => mediaSet.has(p) || isMediaAssetPath(p));

  if (scopeViolations.length > 0) {
    return {
      schemaVersion: 1,
      patchId: validPatch.patchId,
      root,
      appliedAt,
      scopeViolation: true,
      scopeViolations,
      applied: false,
      artifacts: [],
      mediaLinksPassed: null,
      missingMedia: [],
    };
  }

  // 3. Apply under the kernel gate with hash-bound artifacts.
  const kernelReport = await applyPatchWithReport(root, validPatch, options);

  // 4. Post-patch media-link verification.
  let mediaLinksPassed: boolean | null = null;
  let missingMedia: string[] = [];
  if (kernelReport.applied) {
    const verify = await verifyMediaLinks(root);
    mediaLinksPassed = verify.passed;
    missingMedia = verify.checks
      .filter((c) => c.status === 'missing')
      .map((c) => c.clipName);
  }

  return {
    schemaVersion: 1,
    patchId: kernelReport.patchId,
    root: kernelReport.root,
    appliedAt: kernelReport.appliedAt,
    scopeViolation: false,
    scopeViolations: [],
    applied: kernelReport.applied,
    artifacts: kernelReport.artifacts,
    mediaLinksPassed,
    missingMedia,
    before: kernelReport.before,
    after: kernelReport.after,
    diff: kernelReport.diff,
  };
}
