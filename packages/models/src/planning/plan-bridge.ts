import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
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
 * Anything not in these two sets is rejected by the bridge.
 */
const SAFE_READ_ACTIONS = new Set([
  'read_file', 'inspect', 'verify', 'analyze', 'search', 'list',
]);

/**
 * Actions that carry mutation intent. These MUST come with a validated
 * patch attached to the step (handled in E4 Slice 2).
 */
const PATCH_ACTIONS = new Set(['apply_patch', 'patch']);

/**
 * Compiles a read-only plan into executable steps for the engine.
 *
 * This is the LAST security boundary before execution:
 * - Rejects any step whose readOnly flag is false.
 * - Rejects mutation intents without a validated patch.
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
    // Mutation intents require an explicit, validated patch — enforced in Slice 2.
    // For Slice 1 we reject them outright to prove the security boundary holds.
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Step "${step.stepId}" proposes mutation "${step.action}" but the bridge requires a validated patch. Refusing.`,
      { stepId: step.stepId, action: step.action },
    );
  }

  // Unknown actions are rejected — never silently executed.
  throw new JunubError(
    JunubErrorCode.CAPABILITY_NOT_FOUND,
    `Unknown action "${step.action}" in step "${step.stepId}"; bridge refuses unknown actions.`,
    { stepId: step.stepId, action: step.action },
  );
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
      // Generic read actions map to noop so they still appear in the durable log
      // without doing unvetted work. The UI will show them as "completed" steps.
      return {
        stepId: step.stepId,
        statement: step.description,
        action: { kind: 'noop', params: { statement: step.description } },
      };
  }
}
