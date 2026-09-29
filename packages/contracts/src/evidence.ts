import type { EvidenceMethod } from './task.js';

export type CriterionEvidenceStatus =
  | 'pass'
  | 'fail'
  | 'not_run'
  | 'blocked'
  | 'not_applicable'
  | 'human_review_required';

export interface EvidenceRecord {
  readonly id: string;
  readonly criterionId: string;
  readonly artifactHash?: string;
  readonly method: EvidenceMethod;
  readonly status: CriterionEvidenceStatus;
  readonly description: string;
  readonly recordedAt: string;
  readonly details?: Record<string, unknown>;
}
