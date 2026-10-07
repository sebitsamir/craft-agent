import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import { validatePatch } from '@junub-agent/kernel';
import type { ReadOnlyPlan, ReadOnlyPlanStep } from './read-only-planner.js';

/**
 * An executable step compatible with the engine's runTask machinery.
 */
export interface ExecutableStep {
  readonly stepId: string;
  readonly statement: string;
  readonly action: {
    readonly kind: string;
    readonly params: Record<string, unknown>;
  };
}

/**
 * Context used by the bridge to resolve actions against the target workspace.
 */
export interface BridgeContext {
  readonly targetPath: string;
  readonly domain: 'software' | 'film' | 'generic';
  readonly impact?: 'low' | 'medium' | 'high';
  readonly reviewer?: string;
}

/**
 * The result of compiling a plan for execution.
 */
export interface CompiledPlan {
  readonly steps: readonly ExecutableStep[];
  readonly requiresApproval: boolean;
}

/**
 * Actions that are always safe to execute (read-only).
 */
const SAFE_READ_ACTIONS = new Set([
  'read_file', 'inspect', 'verify', 'analyze', 'search', 'list',
]);

/**
 * Actions that carry mutation intent. These compile ONLY when the step
 * carries a patch that passes kernel validation.
 */
const PATCH_ACTIONS = new Set(['apply_patch', 'patch']);

/**
 * Compiles a read-only plan into executable steps for the engine.
 *
 * This is the LAST security boundary before execution:
 * - Rejects any step whose readOnly flag is false.
 * - Compiles mutation intents only when a kernel-valid patch is attached.
 * - Rejects unknown action kinds.
 * - Enforces the F1 reviewer requirement for high-impact tasks.
 */
export function compilePlan(
  plan: ReadOnlyPlan,
  context: BridgeContext,
): CompiledPlan {
  // F1 governance gate: high-impact requires a named reviewer.
  if (context.impact === 'high' && !context.reviewer) {
    throw new JunubError(
      JunubErrorCode.MISSING_REVIEWER_ROLE,
      'High-impact tasks require a named reviewer before execution.',
      { impact: context.impact },
    );
  }

  const steps = plan.steps.map((step) => compileStep(step, context));

  return {
    steps,
    requiresApproval: context.impact === 'high',
  };
}

function compileStep(step: ReadOnlyPlanStep, context: BridgeContext): ExecutableStep {
  // Hard security: the read-only flag must still be true at compile time.
  if (!step.readOnly) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Step "${step.stepId}" has readOnly=false; bridge refuses to compile mutations.`,
      { stepId: step.stepId },
    );
  }

  if (SAFE_READ_ACTIONS.has(step.action)) {
    return compileReadAction(step, context);
  }

  if (PATCH_ACTIONS.has(step.action)) {
    return compilePatchAction(step, context);
  }

  // Unknown actions are rejected — never silently executed.
  throw new JunubError(
    JunubErrorCode.CAPABILITY_NOT_FOUND,
    `Unknown action "${step.action}" in step "${step.stepId}"; bridge refuses unknown actions.`,
    { stepId: step.stepId, action: step.action },
  );
}

/**
 * Compiles a mutation proposal into a guarded patch application.
 *
 * The patch is validated by the KERNEL patch model (schema, scope, path
 * safety). Only a fully valid patch may become an executable step; the
 * actual filesystem mutation still happens later under the worktree gate.
 */
function compilePatchAction(
  step: ReadOnlyPlanStep,
  context: BridgeContext,
): ExecutableStep {
  const proposed = step.proposedPatch;

  if (proposed === undefined) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Step "${step.stepId}" proposes mutation "${step.action}" but carries no patch payload. Refusing.`,
      { stepId: step.stepId, action: step.action },
    );
  }

  const validation = validatePatch(proposed);
  if (!validation.valid) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      `Patch in step "${step.stepId}" failed kernel validation: ${validation.errors.join('; ')}`,
      { stepId: step.stepId, errors: validation.errors },
    );
  }

  const kind = context.domain === 'film' ? 'film.applyPatch' : 'applyPatch';

  return {
    stepId: step.stepId,
    statement: step.description,
    action: { kind, params: { path: context.targetPath, patch: proposed } },
  };
}

function compileReadAction(
  step: ReadOnlyPlanStep,
  context: BridgeContext,
): ExecutableStep {
  const domainPrefix = context.domain === 'film' ? 'film' : 'software';

  switch (step.action) {
    case 'inspect':
    case 'read_file':
    case 'list':
      return {
        stepId: step.stepId,
        statement: step.description,
        action: { kind: `${domainPrefix}.inspect`, params: { path: context.targetPath } },
      };

    case 'verify':
      return {
        stepId: step.stepId,
        statement: step.description,
        action: { kind: `${domainPrefix}.verify`, params: { path: context.targetPath } },
      };

    case 'analyze':
    case 'search':
    default:
      return {
        stepId: step.stepId,
        statement: step.description,
        action: { kind: 'noop', params: { statement: step.description } },
      };
  }
}
