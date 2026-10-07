import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../packages/models/dist/index.js';
import { JunubError } from '../packages/contracts/dist/index.js';

function makePlan(steps) {
  return {
    taskId: 'bridge-test-001',
    steps,
    estimatedTotalModelCalls: steps.length,
    estimatedCostUsd: 0,
    modelUsed: 'mock',
    createdAt: new Date().toISOString(),
  };
}

const baseContext = {
  targetPath: '/tmp/target',
  domain: 'software',
  impact: 'low',
};

describe('E4 Slice 1: Plan-to-Execution Bridge', () => {
  test('compiles valid read-only plan to executable steps', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'inspect', description: 'Inspect repo', readOnly: true, sources: [] },
      { stepId: 's2', action: 'verify', description: 'Verify repo', readOnly: true, sources: [] },
      { stepId: 's3', action: 'analyze', description: 'Analyze', readOnly: true, sources: [] },
    ]);

    const result = compilePlan(plan, baseContext);

    assert.equal(result.steps.length, 3);
    assert.equal(result.steps[0].action.kind, 'software.inspect');
    assert.equal(result.steps[1].action.kind, 'software.verify');
    assert.equal(result.steps[2].action.kind, 'noop');
    assert.equal(result.requiresApproval, false);
  });

  test('uses film prefix for film domain', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'inspect', description: 'Inspect film', readOnly: true, sources: [] },
    ]);

    const result = compilePlan(plan, { ...baseContext, domain: 'film' });

    assert.equal(result.steps[0].action.kind, 'film.inspect');
  });

  test('rejects any step with readOnly=false (hard security boundary)', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'write_file', description: 'Write', readOnly: false, sources: [] },
    ]);

    assert.throws(
      () => compilePlan(plan, baseContext),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'MALFORMED_TASK_CONTRACT');
        assert.ok(err.message.includes('readOnly=false'));
        return true;
      },
    );
  });

  test('rejects mutation intent without validated patch', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'apply_patch', description: 'Patch', readOnly: true, sources: [] },
    ]);

    assert.throws(
      () => compilePlan(plan, baseContext),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'MALFORMED_TASK_CONTRACT');
        assert.ok(err.message.includes('validated patch'));
        return true;
      },
    );
  });

  test('rejects unknown actions (never silently execute)', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'deploy_to_prod', description: 'X', readOnly: true, sources: [] },
    ]);

    assert.throws(
      () => compilePlan(plan, baseContext),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'CAPABILITY_NOT_FOUND');
        assert.ok(err.message.includes('Unknown action'));
        return true;
      },
    );
  });

  test('rejects high-impact tasks without reviewer (F1 rule)', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'inspect', description: 'X', readOnly: true, sources: [] },
    ]);
    const highImpactContext = { ...baseContext, impact: 'high' };

    assert.throws(
      () => compilePlan(plan, highImpactContext),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'MISSING_REVIEWER_ROLE');
        return true;
      },
    );
  });

  test('allows high-impact tasks with named reviewer', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'inspect', description: 'X', readOnly: true, sources: [] },
    ]);
    const highImpactWithReviewer = { ...baseContext, impact: 'high', reviewer: 'alice' };

    const result = compilePlan(plan, highImpactWithReviewer);
    assert.equal(result.requiresApproval, true);
    assert.equal(result.steps.length, 1);
  });
});
