
import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import type { TaskContract } from '@junub-agent/contracts';
import type { BudgetLimits } from '@junub-agent/kernel';
import type {
  ModelCompletionRequest,
  ModelMessage,
  ModelProvider,
} from '../ports/model-provider.js';
import { CapabilityRouter, type RoutingConstraints } from '../routing/capability-router.js';

export interface PlanSourceCitation {
  readonly uri: string;
  readonly retrievedAt: string;
  readonly confidence: number;
  readonly lineRange?: readonly [number, number];
  readonly contentHash?: string;
}

export interface ReadOnlyPlanStep {
  readonly stepId: string;
  readonly action: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly sources: readonly PlanSourceCitation[];
  readonly estimatedModelCalls?: number;
  readonly dependsOn?: readonly string[];
  readonly proposedPatch?: unknown;
}

export interface ReadOnlyPlan {
  readonly taskId: string;
  readonly steps: readonly ReadOnlyPlanStep[];
  readonly estimatedTotalModelCalls: number;
  readonly estimatedCostUsd: number;
  readonly modelUsed: string;
  readonly createdAt: string;
}

export interface PlanRefusal {
  readonly reason: string;
  readonly message: string;
  readonly suggestedNextAction: string;
}

export interface ReadOnlyPlannerDeps {
  readonly router: CapabilityRouter;
  readonly budgetLimits?: BudgetLimits;
}

export async function generateReadOnlyPlan(
  task: TaskContract,
  deps: ReadOnlyPlannerDeps,
): Promise<ReadOnlyPlan | PlanRefusal> {
  const routingConstraints: RoutingConstraints = {
    requiredCapabilities: ['reasoning', 'citation'],
    allowedPrivacyDestinations: ['local', 'self_hosted', 'provider_cloud'],
    requiresToolUse: false,
  };

  const decision = await deps.router.route(routingConstraints);
  const messages = buildPlanningPrompt(task);

  const request: ModelCompletionRequest = {
    modelId: decision.model.modelId,
    messages,
    temperature: 0,
    maxOutputTokens: 4096,
  };

  const response = await decision.provider.complete(request);
  const parsed = parsePlanResponse(response.content, task.taskId ?? 'unknown-task');

  if ('refusal' in parsed) {
    return parsed.refusal;
  }

  enforceReadOnly(parsed.plan);
  enforceBudgetBounds(parsed.plan, deps.budgetLimits);

  const totalModelCalls = parsed.plan.reduce(
    (sum, step) => sum + (step.estimatedModelCalls ?? 1),
    0,
  );

  return {
    taskId: task.taskId ?? 'unknown-task',
    steps: parsed.plan,
    estimatedTotalModelCalls: totalModelCalls,
    estimatedCostUsd: 0,
    modelUsed: response.servedBy,
    createdAt: new Date().toISOString(),
  };
}

function buildPlanningPrompt(task: TaskContract): readonly ModelMessage[] {
  const systemPrompt = `[scenario:simple-plan]
You are a read-only planning assistant for Junub Agent.
You MUST NOT propose any file writes, tool executions, or external mutations.
You MUST respond with ONLY a valid JSON object containing a "plan" array. Do NOT wrap it in markdown code blocks (no \`\`\`json).
Each step must have: stepId, action, description, readOnly (must be true), sources, estimatedModelCalls.
For "sources", provide an array of objects with "uri" (e.g., "file:///path/to/file" or "https://..."), "retrievedAt" (ISO date), and "confidence" (0.0 to 1.0).
If you cannot plan this task, respond with a "refusal" object explaining why.
If a step requires a file mutation, set action to "apply_patch", keep readOnly true, and include the complete patch object in a "patch" field.`;

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

function parsePlanResponse(
  content: string,
  taskId: string,
): { plan: readonly ReadOnlyPlanStep[] } | { refusal: PlanRefusal } {
  let parsed: unknown;

  let cleanedContent = content.trim();
  if (cleanedContent.startsWith('```json')) {
    cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanedContent.startsWith('```')) {
    cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    parsed = JSON.parse(cleanedContent);
  } catch {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Model returned invalid JSON for task "${taskId}". Raw: ${cleanedContent.slice(0, 200)}`,
      { rawContent: cleanedContent.slice(0, 500) },
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'Model plan response must be a JSON object.',
    );
  }

  const obj = parsed as Record<string, unknown>;

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

    // FIX: Gracefully handle missing or malformed sources instead of crashing
    const sources: PlanSourceCitation[] = Array.isArray(step.sources)
      ? step.sources.map((rawSource) => {
        const source = rawSource as Record<string, unknown>;
        const uri = typeof source.uri === 'string' && source.uri.trim().length > 0
          ? source.uri.trim()
          : 'unknown-source';

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
          uri,
          retrievedAt: typeof source.retrievedAt === 'string' ? source.retrievedAt : new Date().toISOString(),
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

function enforceReadOnly(steps: readonly ReadOnlyPlanStep[]): void {
  const mutatingSteps = steps.filter((step) => !step.readOnly);

  if (mutatingSteps.length > 0) {
    const stepIds = mutatingSteps.map((s) => s.stepId).join(', ');
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Read-only planner rejected ${mutatingSteps.length} mutating step(s): [${stepIds}].`,
      { mutatingStepIds: mutatingSteps.map((s) => s.stepId) },
    );
  }

  const DANGEROUS_ACTIONS = [
    'write_file', 'delete_file', 'execute_command', 'push_git',
    'deploy', 'publish', 'send_email', 'make_payment',
  ];

  const dangerousSteps = steps.filter((step) => DANGEROUS_ACTIONS.includes(step.action));

  if (dangerousSteps.length > 0) {
    const stepIds = dangerousSteps.map((s) => s.stepId).join(', ');
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `Read-only planner rejected dangerous action(s) in step(s): [${stepIds}].`,
      { dangerousStepIds: dangerousSteps.map((s) => s.stepId) },
    );
  }
}

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
      `Plan requires ${totalModelCalls} model calls but budget allows only ${limits.maxModelCalls}.`,
      { estimatedModelCalls: totalModelCalls, budgetMaxModelCalls: limits.maxModelCalls },
    );
  }
}
