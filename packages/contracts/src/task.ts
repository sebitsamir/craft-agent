export type TaskImpact = 'low' | 'moderate' | 'high';

export type EvidenceMethod =
  | 'test'
  | 'render'
  | 'source_check'
  | 'expert_review'
  | 'calculation'
  | 'human_review'
  | 'manual_demo';

export interface TaskOutput {
  readonly kind: string;
  readonly format: string;
  readonly description: string;
}

export interface TaskEvidenceRequirement {
  readonly method: EvidenceMethod;
  readonly description: string;
}

export interface TaskAcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly evidence: TaskEvidenceRequirement;
}

export interface TaskReview {
  readonly required: boolean;
  readonly role?: string;
}

export interface TaskContract {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly intent: string;
  readonly domain: string;
  readonly impact: TaskImpact;
  readonly outputs: readonly TaskOutput[];
  readonly acceptance: readonly TaskAcceptanceCriterion[];
  readonly review?: TaskReview;
}

export interface TaskValidationSummary {
  readonly title: string | null;
  readonly domain: string | null;
  readonly impact: TaskImpact | null;
  readonly outputCount: number;
  readonly criterionCount: number;
  readonly qualifiedReviewRequired: boolean;
}

export interface TaskValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly summary: TaskValidationSummary | null;
}
