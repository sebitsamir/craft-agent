import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Import the built packages (dist), not source.
import {
  FakeProvider,
  CapabilityRouter,
  generateReadOnlyPlan,
} from '../packages/models/dist/index.js';

import { JunubError, JunubErrorCode } from '../packages/contracts/dist/index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid TaskContract for planning tests.
 * The planner reads these fields to construct the model prompt.
 */
function makeTask(overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: 'task-f3-test',
    projectId: 'project-f3',
    title: 'F3 planning test task',
    intent: 'Verify the read-only planner produces cited, bounded plans.',
    domain: 'software',
    impact: 'low',
    outputs: [
      {
        kind: 'document',
        format: 'markdown',
        description: 'A planning summary document.',
      },
    ],
    acceptance: [
      {
        id: 'criterion-1',
        statement: 'The plan must be read-only and cite sources.',
        evidence: {
          method: 'source_check',
          description: 'Inspect the plan for citations and readOnly flags.',
        },
      },
    ],
    ...overrides,
  };
}

/**
 * Creates an inline model provider that returns a fixed content string.
 *
 * This lets tests exercise the planner's validation logic (read-only
 * enforcement, budget bounds, refusal handling) without depending on the
 * scripted FakeProvider scenarios.
 */
function makeInlineProvider(content) {
  return {
    providerId: 'test-inline',

    async listModels() {
      return [
        {
          modelId: 'inline-model-v1',
          displayName: 'Inline Test Model',
          providerId: 'test-inline',
          capabilities: ['reasoning', 'citation'],
          maxContextTokens: 8192,
          maxOutputTokens: 4096,
          costPerInputMillionTokens: 0,
          costPerOutputMillionTokens: 0,
          privacyDestination: 'local',
          supportsToolUse: false,
          supportsStreaming: false,
        },
      ];
    },

    async complete() {
      return {
        content,
        toolCalls: [],
        servedBy: 'inline-model-v1',
        usage: { inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0, latencyMs: 0 },
        stopReason: 'end_turn',
      };
    },

    async isAvailable() {
      return true;
    },
  };
}

/**
 * Builds a CapabilityRouter wired to a single inline provider.
 */
async function makeRouterWithContent(content) {
  const router = new CapabilityRouter([makeInlineProvider(content)]);
  await router.refreshModels();
  return router;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F3 Slice 1: Model provider, routing, and read-only planning', () => {
  test('FakeProvider returns deterministic scripted responses', async () => {
    const provider = new FakeProvider();

    const request = {
      modelId: 'fake-deterministic-v1',
      messages: [
        { role: 'system', content: '[scenario:simple-plan] You are a planner.' },
        { role: 'user', content: 'Plan something.' },
      ],
      temperature: 0,
    };

    const first = await provider.complete(request);
    const second = await provider.complete(request);

    // Determinism: identical input produces identical output.
    assert.equal(first.content, second.content);
    assert.equal(first.servedBy, 'fake-deterministic-v1');
    assert.equal(first.usage.estimatedCostUsd, 0);
  });

  test('CapabilityRouter routes by required capabilities', async () => {
    const router = new CapabilityRouter([new FakeProvider()]);
    await router.refreshModels();

    const decision = await router.route({
      requiredCapabilities: ['reasoning', 'citation'],
    });

    assert.equal(decision.model.modelId, 'fake-deterministic-v1');
    assert.equal(decision.provider.providerId, 'fake');
    assert.ok(decision.reason.includes('fake-deterministic-v1'));
  });

  test('CapabilityRouter reports CAPABILITY_NOT_FOUND when no model matches', async () => {
    const router = new CapabilityRouter([new FakeProvider()]);
    await router.refreshModels();

    // The fake model does not advertise video_generation.
    await assert.rejects(
      router.route({ requiredCapabilities: ['video_generation'] }),
      (err) => err instanceof JunubError && err.code === JunubErrorCode.CAPABILITY_NOT_FOUND,
    );
  });

  test('planner produces a cited, read-only plan with budget estimate', async () => {
    const router = new CapabilityRouter([new FakeProvider()]);
    await router.refreshModels();

    const result = await generateReadOnlyPlan(makeTask(), { router });

    // Must be a plan, not a refusal.
    assert.ok('steps' in result, 'Expected a plan, got a refusal.');
    assert.ok(result.steps.length > 0, 'Plan must contain at least one step.');

    // Every step must be read-only and cite at least one source.
    for (const step of result.steps) {
      assert.equal(step.readOnly, true, `Step ${step.stepId} must be readOnly.`);
      assert.ok(step.sources.length > 0, `Step ${step.stepId} must cite sources.`);
      for (const source of step.sources) {
        assert.ok(source.uri.length > 0, 'Citation must have a URI.');
        assert.ok(source.retrievedAt.length > 0, 'Citation must have a retrieval date.');
      }
    }

    // Budget estimate must be present and non-negative.
    assert.ok(result.estimatedTotalModelCalls > 0);
    assert.ok(result.modelUsed.length > 0);
  });

  test('planner REJECTS a plan containing a mutating step', async () => {
    const mutatingPlan = JSON.stringify({
      plan: [
        {
          stepId: 's1',
          action: 'read_files',
          description: 'Read files.',
          readOnly: false, // <-- Violation: not read-only.
          sources: [{ uri: 'file:///src', retrievedAt: '2026-10-01T00:00:00Z', confidence: 1 }],
        },
      ],
    });

    const router = await makeRouterWithContent(mutatingPlan);

    await assert.rejects(
      generateReadOnlyPlan(makeTask(), { router }),
      (err) => err instanceof JunubError && /read-only/i.test(err.message),
    );
  });

  test('planner REJECTS a dangerous action even if marked readOnly', async () => {
    const dangerousPlan = JSON.stringify({
      plan: [
        {
          stepId: 's1',
          action: 'write_file', // <-- Dangerous action, never allowed in planning.
          description: 'Write a file.',
          readOnly: true, // Lying about readOnly must not bypass the guard.
          sources: [{ uri: 'file:///src', retrievedAt: '2026-10-01T00:00:00Z', confidence: 1 }],
        },
      ],
    });

    const router = await makeRouterWithContent(dangerousPlan);

    await assert.rejects(
      generateReadOnlyPlan(makeTask(), { router }),
      (err) => err instanceof JunubError && /dangerous action/i.test(err.message),
    );
  });

  test('planner enforces budget bounds and rejects over-budget plans', async () => {
    // The simple-plan scenario produces 2 steps (2 estimated model calls).
    const router = new CapabilityRouter([new FakeProvider()]);
    await router.refreshModels();

    await assert.rejects(
      generateReadOnlyPlan(makeTask(), {
        router,
        budgetLimits: { maxModelCalls: 1 }, // Tighter than the plan needs.
      }),
      (err) => err instanceof JunubError && err.code === JunubErrorCode.BUDGET_EXCEEDED,
    );
  });

  test('planner returns an honest refusal when the model declines', async () => {
    const refusal = JSON.stringify({
      plan: [],
      refusal: {
        reason: 'UNSUPPORTED',
        message: 'This task requires video generation, which is unavailable.',
        suggestedNextAction: 'Install the media capability pack.',
      },
    });

    const router = await makeRouterWithContent(refusal);
    const result = await generateReadOnlyPlan(makeTask(), { router });

    // Must be a refusal, not a plan.
    // The planner returns the PlanRefusal object directly, not wrapped in { refusal: ... }.
    assert.ok(!('steps' in result), 'Expected a refusal, got a plan.');
    assert.ok('reason' in result, 'Refusal must have a reason.');

    assert.equal(result.reason, 'UNSUPPORTED');
    assert.ok(result.message.length > 0);
    assert.ok(result.suggestedNextAction.length > 0);
  });
});
