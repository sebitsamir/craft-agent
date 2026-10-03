import { CraftError, CraftErrorCode } from '@craft-agent/contracts'

/**
 * Budget limits declared by a task/project/user.
 *
 * Absence of a field means "no explicit limit provided".
 * It does not mean infinite; later kernel policy may impose system defaults.
 */
export interface BudgetLimits {
  readonly maxModelCalls?: number;
  readonly maxComputeMinutes?: number;
  readonly maxCost?: number;
  readonly maxStorageBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxRetryAttempts?: number;
}

/**
 * Actual measured usage for a task run.
 *
 * All fields are required here so the scheduler never accidentally treats
 * undefined as zero.
 */
export interface BudgetUsage {
  readonly modelCalls: number;
  readonly computeMinutes: number;
  readonly cost: number;
  readonly storageBytes: number;
  readonly outputBytes: number;
  readonly retryAttempts: number;
}

/**
 * Safe initial usage state for a new task run.
 */
export const ZERO_BUDGET_USAGE: BudgetUsage = {
  modelCalls: 0,
  computeMinutes: 0,
  cost: 0,
  storageBytes: 0,
  outputBytes: 0,
  retryAttempts: 0,
};

/**
 * Mapping between limit fields and usage fields.
 *
 * This avoids duplicated if/else logic and makes the budget rules explicit.
 */
const BUDGET_CHECKS: ReadonlyArray<{
  limitField: keyof BudgetLimits;
  usageField: keyof BudgetUsage;
  label: string;
}> = [
  {
    limitField: 'maxModelCalls',
    usageField: 'modelCalls',
    label: 'model calls',
  },
  {
    limitField: 'maxComputeMinutes',
    usageField: 'computeMinutes',
    label: 'compute minutes',
  },
  {
    limitField: 'maxCost',
    usageField: 'cost',
    label: 'estimated/actual cost',
  },
  {
    limitField: 'maxStorageBytes',
    usageField: 'storageBytes',
    label: 'storage bytes',
  },
  {
    limitField: 'maxOutputBytes',
    usageField: 'outputBytes',
    label: 'output bytes',
  },
  {
    limitField: 'maxRetryAttempts',
    usageField: 'retryAttempts',
    label: 'retry attempts',
  },
];

/**
 * Throws BUDGET_EXCEEDED if usage exceeds any declared limit.
 *
 * This function does not mutate usage. It is a pure guard.
 */
export function checkBudget(
  limits: BudgetLimits | undefined,
  usage: BudgetUsage,
): void {
  // If no budget was declared, there is nothing to enforce at this layer.
  if (!limits) {
    return;
  }

  for (const check of BUDGET_CHECKS) {
    const limit = limits[check.limitField];
    const used = usage[check.usageField];

    // Only enforce limits that were explicitly provided.
    if (limit === undefined) {
      continue;
    }

    // Invalid limit values are a contract bug, not a runtime usage problem.
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      throw new CraftError(
        CraftErrorCode.INVALID_BUDGET,
        `Budget limit "${check.limitField}" must be a non-negative finite number.`,
        { limitField: check.limitField, limit },
      );
    }

    // Budget exhaustion is a controlled stop.
    // The caller must persist partial state and report how to continue.
    if (used > limit) {
      throw new CraftError(
        CraftErrorCode.BUDGET_EXCEEDED,
        `Budget exceeded for ${check.label}: used ${used}, limit ${limit}.`,
        {
          limitField: check.limitField,
          usageField: check.usageField,
          used,
          limit,
        },
      );
    }
  }
}
