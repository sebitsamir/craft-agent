import { CraftError, CraftErrorCode } from './errors.js';
import type { TaskContract, EvidenceMethod } from './task.js';
import type { ArtifactVersion } from './artifact.js';

/**
 * Shared evidence statuses.
 *
 * A required criterion that is FAILED, BLOCKED, or NOT_RUN cannot be
 * presented as VERIFIED.
 */
export type CriterionEvidenceStatus =
  | 'pass'
  | 'fail'
  | 'not_run'
  | 'blocked'
  | 'not_applicable'
  | 'human_review_required';

/**
 * A criterion-bound evidence record.
 *
 * Evidence is only meaningful when bound to:
 * - a task acceptance criterion id
 * - an artifact id
 * - an artifact version
 * - the exact content hash of that artifact version
 */
export interface EvidenceRecord {
  readonly id: string;
  readonly criterionId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly contentHash: string;
  readonly method: EvidenceMethod;
  readonly status: CriterionEvidenceStatus;
  readonly description: string;
  readonly recordedAt: string;

  readonly environment?: string;
  readonly sourceReference?: string;
  readonly boundedOutput?: string;
  readonly reviewer?: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Validates that an evidence record binds accurately to a task criterion and
 * to a specific artifact version.
 *
 * This is one of the core integrity rules of Craft Agent:
 * evidence must refer to exact immutable content, not to “the latest file”.
 */
export function validateEvidenceBinding(
  evidence: EvidenceRecord,
  task: TaskContract,
  artifactVersion: ArtifactVersion,
): void {
  const criterionExists = task.acceptance.some(
    (criterion) => criterion.id === evidence.criterionId,
  );

  if (!criterionExists) {
    throw new CraftError(
      CraftErrorCode.EVIDENCE_UNBOUND_CRITERION,
      `Evidence references unknown criterion id "${evidence.criterionId}" in task.`,
      { criterionId: evidence.criterionId },
    );
  }

  if (evidence.artifactId !== artifactVersion.artifactId) {
    throw new CraftError(
      CraftErrorCode.EVIDENCE_UNBOUND_ARTIFACT,
      `Evidence artifactId "${evidence.artifactId}" does not match target artifactId "${artifactVersion.artifactId}".`,
      {
        expectedArtifactId: artifactVersion.artifactId,
        actualArtifactId: evidence.artifactId,
      },
    );
  }

  if (evidence.artifactVersion !== artifactVersion.version) {
    throw new CraftError(
      CraftErrorCode.ARTIFACT_VERSION_MISMATCH,
      `Evidence artifactVersion "${evidence.artifactVersion}" does not match target version "${artifactVersion.version}".`,
      {
        expectedVersion: artifactVersion.version,
        actualVersion: evidence.artifactVersion,
      },
    );
  }

  if (evidence.contentHash.toLowerCase() !== artifactVersion.hash.toLowerCase()) {
    throw new CraftError(
      CraftErrorCode.EVIDENCE_HASH_MISMATCH,
      `Evidence contentHash "${evidence.contentHash}" does not match artifact version hash "${artifactVersion.hash}".`,
      {
        expectedHash: artifactVersion.hash,
        actualHash: evidence.contentHash,
      },
    );
  }
}
