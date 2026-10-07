import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import type { TaskContract } from '@junub-agent/contracts';
import type { BudgetLimits } from '@junub-agent/kernel';
import type {
  ModelCompletionRequest,
  ModelMessage,
  ModelProvider,
} from '../ports/model-provider.js';
import { CapabilityRouter, type RoutingConstraints } from '../routing/capability-router.js';

/**
 * Read-Only Planner
 *
 * This is the F3 planning layer. It asks a model to produce a PLAN,
 * but the plan is strictly READ-ONLY:
 * - No file writes.
 * - No tool execution.
 * - No external mutations.
 * - No permission escalation.
 *
 * The Master Spec (Section 7.1) is clear:
 * "The model proposes steps; the runtime validates every tool input and
 * decides whether an action may execute."
 *
 * The planner's job is to:
 * 1. Route to an appropriate model via capability routing.
 * 2. Send the task contract as a structured prompt.
 * 3. Parse the model's proposed plan.
 * 4. VALIDATE that the plan is read-only and budget-bounded.
 * 5. Return a typed, cited plan or throw an accurate failure.
 */

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

/**
 * A source citation attached to a plan step.
 *
 * The Master Spec (Section 11) requires:
 * "Attach source URI/path, line/page/time range, retrieval date,
 * jurisdiction/standard version, content hash and confidence."
 */
export interface PlanSourceCitation {
  readonly uri: string;
  readonly retrievedAt: string;
  readonly confidence: number;
  readonly lineRange?: readonly [number, number];
  readonly contentHash?: string;
}

/**
 * A single step in a read-only plan.
 */
export interface ReadOnlyPlanStep {
  readonly stepId: string;
  readonly action: string;
  readonly description: string;

  /** MUST be true for F3. Any mutation makes the plan invalid. */
  readonly readOnly: boolean;

  /** Sources the model used to justify this step. */
  readonly sources: readonly PlanSourceCitation[];

  /** Estimated model calls this step will require. */
  readonly estimatedModelCalls?: number;

  /** Dependencies: step IDs that must complete before this one. */
  readonly dependsOn?: readonly string[];

  /**
   * Optional patch PROPOSED by the model (E4).
   *
   * This is a proposal only — it never executes in the planner. The
   * plan-to-execution bridge validates it against the kernel patch model
   * before it may become an executable step.
   */
  readonly proposedPatch?: unknown;
}

/**
 * A complete read-only plan with budget estimate.
 */
export interface ReadOnlyPlan {
  readonly taskId: string;
  readonly steps: readonly ReadOnlyPlanStep[];
  readonly estimatedTotalModelCalls: number;
  readonly estimatedCostUsd: number;
  readonly modelUsed: string;
  readonly createdAt: string;
}

/**
 * A refusal returned when the model honestly reports it cannot plan.
 */
export interface PlanRefusal {
  readonly reason: string;
  readonly message: string;
  readonly suggestedNextAction: string;
}

// ---------------------------------------------------------------------------
// Planner implementation
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the planner.
 */
export interface ReadOnlyPlannerDeps {
  readonly router: CapabilityRouter;
  readonly budgetLimits?: BudgetLimits;
}

/**
 * Generates a read-only, cited, budget-bounded plan for a task.
 *
 * This function NEVER:
 * - Writes files
 * - Executes tools
 * - Mutates state
 * - Grants permissions
 *
 * It ONLY:
 * - Asks a model for a plan
 * - Validates the plan structure
 * - Enforces read-only constraints
 * - Checks budget bounds
 * - Returns typed output or throws an accurate error
 */
export async function generateReadOnlyPlan(
  task: TaskContract,
  deps: ReadOnlyPlannerDeps,
): Promise<ReadOnlyPlan | PlanRefusal> {
  // 1. Route to a model capable of reasoning + citation.
  const routingConstraints: RoutingConstraints = {
    requiredCapabilities: ['reasoning', 'citation'],
    allowedPrivacyDestinations: ['local', 'self_hosted', 'provider_cloud'],
    requiresToolUse: false, // Planning is read-only; no tools needed.
  };

  const decision = await deps.router.route(routingConstraints);

  // 2. Build the planning prompt.
  const messages = buildPlanningPrompt(task);

  // 3. Call the model.
  const request: ModelCompletionRequest = {
    modelId: decision.model.modelId,
    messages,
    temperature: 0, // Deterministic planning.
    maxOutputTokens: 4096,
  };

  const response = await decision.provider.complete(request);

  // 4. Parse the model's response.
  const parsed = parsePlanResponse(response.content, task.taskId ?? 'unknown-task');

  // 5. If the model refused, return the refusal honestly.
  if ('refusal' in parsed) {
    return parsed.refusal;
  }

  // 6. Validate the plan is truly read-only.
  enforceReadOnly(parsed.plan);

  // 7. Check budget bounds.
  enforceBudgetBounds(parsed.plan, deps.budgetLimits);

  // 8. Build the final typed plan.
  const totalModelCalls = parsed.plan.reduce(
    (sum, step) => sum + (step.estimatedModelCalls ?? 1),
    0,
  );

  return {
    taskId: task.taskId ?? 'unknown-task',
    steps: parsed.plan,
    estimatedTotalModelCalls: totalModelCalls,
    estimatedCostUsd: 0, // Fake provider is free; real adapters compute this.
    modelUsed: response.servedBy,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the system + user messages for a planning request.
 */
function buildPlanningPrompt(task: TaskContract): readonly ModelMessage[] {
  const systemPrompt = `[scenario:simple-plan]
You are a read-only planning assistant for Junub Agent.
You MUST NOT propose any file writes, tool executions, or external mutations.
You MUST cite sources for every step.
You MUST respond with a JSON object containing a "plan" array.
Each step must have: stepId, action, description, readOnly (must be true), sources, estimatedModelCalls.
If you cannot plan this task, respond with a "refusal" object explaining why.
If a step requires a file mutation, set action to "apply_patch", keep readOnly true, and include the complete patch object in a "patch" field. The runtime validates every patch before execution; unvalidated patches are rejected.`;

  const userPrompt = `Task: ${task.title}
Intent: ${task.intent}
Domain: ${task.domain}
Impact: ${task.impact}
Outputs: ${task.outputs.map((o) => `${o.kind} (${o.format})`).join(', ')}
Acceptance criteria: ${task.acceptance.map((c) => c.statement).join('; ')}

Produce a read-only plan.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Parses the model's JSON response into typed plan steps or a refusal.
 */
function parsePlanResponse(
  content: string,
  taskId: string,
): { plan: readonly ReadOnlyPlanStep[] } | { refusal: PlanRefusal } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Model returned invalid JSON for task "${taskId}". The plan cannot be trusted.`,
      { rawContent: content.slice(0, 500) },
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'Model plan response must be a JSON object.',
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Check for honest refusal.
  if (obj.refusal && typeof obj.refusal === 'object') {
    const refusal = obj.refusal as Record<string, unknown>;
    return {
      refusal: {
        reason: String(refusal.reason ?? 'UNKNOWN'),
        message: String(refusal.message ?? 'Model refused without explanation.'),
        suggestedNextAction: String(refusal.suggestedNextAction ?? 'Review task constraints.'),
      },
    };
  }

  // Parse plan steps.
  if (!Array.isArray(obj.plan)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'Model plan response must contain a "plan" array.',
    );
  }

  const steps: ReadOnlyPlanStep[] = obj.plan.map((rawStep, index) => {
    const step = rawStep as Record<string, unknown>;

    if (typeof step.stepId !== 'string' || step.stepId.trim().length === 0) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `Plan step ${index} must have a nonempty "stepId".`,
      );
    }

    if (typeof step.action !== 'string' || step.action.trim().length === 0) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `Plan step ${index} must have a nonempty "action".`,
      );
    }

    if (typeof step.description !== 'string' || step.description.trim().length === 0) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `Plan step ${index} must have a nonempty "description".`,
      );
    }

    // Parse sources.
    const sources: PlanSourceCitation[] = Array.isArray(step.sources)
      ? step.sources.map((rawSource, sourceIndex) => {
        const source = rawSource as Record<string, unknown>;
        if (typeof source.uri !== 'string' || source.uri.trim().length === 0) {
          throw new JunubError(
            JunubErrorCode.MALFORMED_TASK_CONTRACT,
            `Plan step ${index} source ${sourceIndex} must have a nonempty "uri".`,
          );
        }

        // Strictly validate the [number, number] tuple for lineRange
        let parsedLineRange: readonly [number, number] | undefined = undefined;
        if (
          Array.isArray(source.lineRange) &&
          source.lineRange.length === 2 &&
          typeof source.lineRange[0] === 'number' &&
          typeof source.lineRange[1] === 'number'
        ) {
          parsedLineRange = [source.lineRange[0], source.lineRange[1]];
        }

        return {
          uri: source.uri,
          retrievedAt: String(source.retrievedAt ?? new Date().toISOString()),
          confidence: typeof source.confidence === 'number' ? source.confidence : 0.5,
          lineRange: parsedLineRange,
          contentHash: typeof source.contentHash === 'string' ? source.contentHash : undefined,
        };
      })
      : [];

    return {
      stepId: String(step.stepId),
      action: String(step.action),
      description: String(step.description),
      readOnly: step.readOnly === true,
      sources,
      estimatedModelCalls: typeof step.estimatedModelCalls === 'number' ? step.estimatedModelCalls : 1,
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : undefined,
      proposedPatch: step.patch !== undefined ? step.patch : undefined,
    };
  });

  return { plan: steps };
}

/**
 * Enforces that every step in the plan is read-only.
 *
 * This is a HARD SECURITY BOUNDARY. A model cannot sneak a write operation
 * into a plan by setting readOnly: false. The planner rejects it.
 */
function enforceReadOnly(steps: readonly ReadOnlyPlanStep[]): void {
  const mutatingSteps = steps.filter((step) => !step.readOnly);

  if (mutatingSteps.length > 0) {
    const stepIds = mutatingSteps.map((s) => s.stepId).join(', ');
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Read-only planner rejected ${mutatingSteps.length} mutating step(s): [${stepIds}]. F3 plans must be strictly read-only.`,
      { mutatingStepIds: mutatingSteps.map((s) => s.stepId) },
    );
  }

  // Additionally reject known dangerous action names even if readOnly is true.
  const DANGEROUS_ACTIONS = [
    'write_file', 'delete_file', 'execute_command', 'push_git',
    'deploy', 'publish', 'send_email', 'make_payment',
  ];

  const dangerousSteps = steps.filter((step) =>
    DANGEROUS_ACTIONS.includes(step.action),
  );

  if (dangerousSteps.length > 0) {
    const stepIds = dangerousSteps.map((s) => s.stepId).join(', ');
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Read-only planner rejected dangerous action(s) in step(s): [${stepIds}]. These actions are never allowed in planning mode.`,
      { dangerousStepIds: dangerousSteps.map((s) => s.stepId) },
    );
  }
}

/**
 * Enforces that the plan fits within the declared budget.
 *
 * The Master Spec (Section 11) requires:
 * "A budget exhaustion result includes the partial artifact and steps
 * needed to continue, without marking completion."
 */
function enforceBudgetBounds(
  steps: readonly ReadOnlyPlanStep[],
  limits: BudgetLimits | undefined,
): void {
  if (!limits) return;

  const totalModelCalls = steps.reduce(
    (sum, step) => sum + (step.estimatedModelCalls ?? 1),
    0,
  );

  if (limits.maxModelCalls !== undefined && totalModelCalls > limits.maxModelCalls) {
    throw new JunubError(
      JunubErrorCode.BUDGET_EXCEEDED,
      `Plan requires ${totalModelCalls} model calls but budget allows only ${limits.maxModelCalls}. Reduce plan scope or increase budget.`,
      {
        estimatedModelCalls: totalModelCalls,
        budgetMaxModelCalls: limits.maxModelCalls,
      },
    );
  }
}
