import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateReadOnlyPlan } from '../packages/models/dist/index.js';
import { CapabilityRouter } from '../packages/models/dist/index.js';
import { QwenProvider } from '../packages/models/dist/index.js';
import { JunubError } from '../packages/contracts/dist/index.js';

class MockProvider {
  constructor(responseContent, modelId = 'mock-model') {
    this.providerId = 'mock';
    this.responseContent = responseContent;
    this.modelId = modelId;
  }
  async isAvailable() { return true; }
  async listModels() {
    return [{
      modelId: this.modelId, displayName: 'Mock', providerId: 'mock',
      capabilities: ['reasoning', 'citation'], maxContextTokens: 4000, maxOutputTokens: 2000,
      costPerInputMillionTokens: 0, costPerOutputMillionTokens: 0,
      privacyDestination: 'local', supportsToolUse: false, supportsStreaming: false,
    }];
  }
  async complete() {
    return {
      content: this.responseContent, toolCalls: [], servedBy: this.modelId,
      usage: { inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0, latencyMs: 5 },
      stopReason: 'end_turn',
    };
  }
}

const baseTask = {
  taskId: 'plan-test-001', title: 'Analyze codebase', intent: 'Find bugs',
  domain: 'software', impact: 'low',
  outputs: [{ kind: 'report', format: 'markdown' }],
  acceptance: [{ id: 'a1', statement: 'Report generated' }],
};

describe('E3 Slice 3: Read-Only Planner Integration', () => {
  test('planner parses valid read-only plan from provider', async () => {
    const validJson = JSON.stringify({
      plan: [{
        stepId: 's1', action: 'read_file', description: 'Read main.ts', readOnly: true,
        sources: [{ uri: 'file:///main.ts', retrievedAt: '2024-01-01T00:00:00Z', confidence: 1.0 }],
        estimatedModelCalls: 1
      }]
    });
    const router = new CapabilityRouter([new MockProvider(validJson)]);
    const result = await generateReadOnlyPlan(baseTask, { router });

    assert.ok('steps' in result);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].action, 'read_file');
    assert.equal(result.steps[0].readOnly, true);
    assert.equal(result.modelUsed, 'mock-model');
  });

  test('planner rejects mutating plans (hard security boundary)', async () => {
    const mutatingJson = JSON.stringify({
      plan: [{
        stepId: 's1', action: 'write_file', description: 'Write main.ts', readOnly: false,
        sources: [], estimatedModelCalls: 1
      }]
    });
    const router = new CapabilityRouter([new MockProvider(mutatingJson)]);
    
    await assert.rejects(
      () => generateReadOnlyPlan(baseTask, { router }),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'MALFORMED_TASK_CONTRACT');
        assert.ok(err.message.includes('mutating'));
        return true;
      }
    );
  });

  test('planner handles honest refusal from provider', async () => {
    const refusalJson = JSON.stringify({
      refusal: { reason: 'INSUFFICIENT_CONTEXT', message: 'Cannot plan without repo access.', suggestedNextAction: 'Provide access.' }
    });
    const router = new CapabilityRouter([new MockProvider(refusalJson)]);
    const result = await generateReadOnlyPlan(baseTask, { router });

    // The planner returns the PlanRefusal object directly, not wrapped in a 'refusal' key
    assert.ok(!('steps' in result), 'Result should be a refusal, not a plan');
    assert.equal(result.reason, 'INSUFFICIENT_CONTEXT');
    assert.equal(result.message, 'Cannot plan without repo access.');
  });

  test('planner integrates with real QwenProvider (skipped without key)', {
    skip: !(process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY)
  }, async () => {
    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    const qwen = new QwenProvider({ apiKey, timeoutMs: 30000 });
    const router = new CapabilityRouter([qwen]);
    await router.refreshModels();

    const result = await generateReadOnlyPlan(baseTask, { router });

    if ('steps' in result) {
      assert.ok(result.steps.length > 0);
      assert.ok(result.steps.every(s => s.readOnly === true), 'All steps must be read-only');
      assert.ok(result.modelUsed.includes('qwen'));
    } else {
      assert.ok('reason' in result, 'Refusal object must have a reason');
      assert.ok(result.reason.length > 0);
    }
  });
});
