import { CraftError, CraftErrorCode } from './errors.js';

/**
 * Declared task impact.
 *
 * This is user-declared input in F1, not a full risk classifier. Future
 * phases may add policy-driven impact reclassification.
 */
export type TaskImpact = 'low' | 'moderate' | 'high';

/**
 * Evidence methods allowed in task acceptance criteria.
 *
 * The set is intentionally domain-neutral. Domain packs interpret what each
 * method means in practice.
 */
export type EvidenceMethod =
  | 'test'
  | 'render'
  | 'source_check'
  | 'expert_review'
  | 'calculation'
  | 'human_review'
  | 'manual_demo';

/**
 * A desired output declared by the task contract.
 */
export interface TaskOutput {
  readonly id?: string;
  readonly kind: string;
  readonly format: string;
  readonly description: string;
  readonly required?: boolean;
  readonly pathPattern?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Evidence required for one acceptance criterion.
 */
export interface TaskEvidenceRequirement {
  readonly method: EvidenceMethod;
  readonly description: string;
  readonly requiredArtifactIds?: readonly string[];
}

/**
 * One acceptance criterion bound to required evidence.
 */
export interface TaskAcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly evidence: TaskEvidenceRequirement;
  readonly required?: boolean;
}

/**
 * Review requirements for a task.
 *
 * Compatibility note:
 * - `role` supports the v0.3 single-role shape.
 * - `roles` supports future multi-role review.
 */
export interface TaskReview {
  readonly required: boolean;
  readonly role?: string;
  readonly roles?: readonly string[];
}

/**
 * Budget limits for a task.
 *
 * All values are optional and non-negative. Absence means “not specified,”
 * not unlimited. Kernel policy may impose system defaults later.
 */
export interface TaskBudget {
  readonly maxModelCalls?: number;
  readonly maxComputeMinutes?: number;
  readonly maxCost?: number;
  readonly maxStorageBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxRetryAttempts?: number;
}

/**
 * Deadlines for a task.
 *
 * Values should be ISO 8601 timestamps.
 */
export interface TaskDeadlines {
  readonly target?: string;
  readonly hardStop?: string;
}

/**
 * The universal, domain-neutral task contract.
 *
 * A TaskContract defines what is requested and what will count as evidence.
 * It does not contain execution state. Execution state belongs to the kernel.
 */
export interface TaskContract {
  readonly schemaVersion: 1;

  readonly taskId?: string;
  readonly projectId?: string;

  /**
   * Immutable contract version. If present, versions must increase over time.
   */
  readonly version?: number;

  readonly title: string;
  readonly intent: string;

  /**
   * Primary domain. Additional domains may be declared for cross-domain work.
   */
  readonly domain: string;
  readonly domains?: readonly string[];

  readonly impact: TaskImpact;

  readonly outputs: readonly TaskOutput[];
  readonly acceptance: readonly TaskAcceptanceCriterion[];

  readonly review?: TaskReview;

  readonly constraints?: readonly string[];
  readonly sources?: readonly string[];
  readonly deadlines?: TaskDeadlines;
  readonly budget?: TaskBudget;

  readonly policyVersion?: string;

  readonly createdAt?: string;
  readonly updatedAt?: string;

  readonly metadata?: Record<string, unknown>;
}

/**
 * Returns a deduplicated list of reviewer roles declared on a task review.
 */
export function getTaskReviewRoles(review: TaskReview | undefined): readonly string[] {
  if (!review) {
    return [];
  }

  const roles: string[] = [];

  const addRole = (role: string): void => {
    if (!roles.includes(role)) {
      roles.push(role);
    }
  };

  if (review.role) {
    addRole(review.role);
  }

  if (review.roles) {
    for (const role of review.roles) {
      addRole(role);
    }
  }

  return roles;
}

/**
 * Validates evolution between two task contract versions.
 *
 * Current invariants:
 * - If both versions are present, next.version must be strictly greater.
 * - Acceptance criteria cannot silently disappear.
 */
export function validateTaskEvolution(previous: TaskContract, next: TaskContract): void {
  if (previous.version !== undefined && next.version !== undefined) {
    if (next.version <= previous.version) {
      throw new CraftError(
        CraftErrorCode.INVALID_TASK_VERSION,
        `Next task version (${next.version}) must be strictly greater than previous version (${previous.version}).`,
        {
          previousVersion: previous.version,
          nextVersion: next.version,
        },
      );
    }
  }

  const nextCriterionIds = new Set(next.acceptance.map((criterion) => criterion.id));
  const missingCriterionIds = previous.acceptance
    .map((criterion) => criterion.id)
    .filter((id) => !nextCriterionIds.has(id));

  if (missingCriterionIds.length > 0) {
    throw new CraftError(
      CraftErrorCode.CRITERION_REMOVAL_DISALLOWED,
      `Acceptance criteria cannot silently disappear between task versions. Missing criteria: ${missingCriterionIds.join(', ')}.`,
      { missingCriterionIds },
    );
  }
}
