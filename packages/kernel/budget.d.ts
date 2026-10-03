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
export declare const ZERO_BUDGET_USAGE: BudgetUsage;
/**
 * Throws BUDGET_EXCEEDED if usage exceeds any declared limit.
 *
 * This function does not mutate usage. It is a pure guard.
 */
export declare function checkBudget(limits: BudgetLimits | undefined, usage: BudgetUsage): void;
//# sourceMappingURL=budget.d.ts.map