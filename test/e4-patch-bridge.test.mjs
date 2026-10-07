import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../packages/models/dist/index.js';
import { JunubError } from '../packages/contracts/dist/index.js';

const validPatch = {
  schemaVersion: 1,
  patchId: 'p-bridge-1',
  description: 'Add notes file',
  allowedPaths: ['notes.txt'],
  operations: [{ kind: 'create', path: 'notes.txt', content: 'hello\n' }],
};

const traversalPatch = {
  schemaVersion: 1,
  patchId: 'p-bridge-2',
  description: 'Escape attempt',
  allowedPaths: ['notes.txt'],
  operations: [{ kind: 'create', path: '../escape.txt', content: 'x\n' }],
};

function makePlan(steps) {
  return {
    taskId: 'bridge-patch-001',
    steps,
    estimatedTotalModelCalls: steps.length,
    estimatedCostUsd: 0,
    modelUsed: 'mock',
    createdAt: new Date().toISOString(),
  };
}

const baseContext = { targetPath: '/tmp/target', domain: 'software', impact: 'low' };

describe('E4 Slice 2: validated patch attachment', () => {
  test('compiles apply_patch with a valid patch into applyPatch step', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'apply_patch', description: 'Add notes', readOnly: true, sources: [], proposedPatch: validPatch },
    ]);

    const result = compilePlan(plan, baseContext);

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].action.kind, 'applyPatch');
    assert.equal(result.steps[0].action.params.path, '/tmp/target');
    assert.deepEqual(result.steps[0].action.params.patch, validPatch);
  });

  test('uses film.applyPatch for film domain', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'apply_patch', description: 'Edit EDL', readOnly: true, sources: [], proposedPatch: validPatch },
    ]);

    const result = compilePlan(plan, { ...baseContext, domain: 'film' });
    assert.equal(result.steps[0].action.kind, 'film.applyPatch');
  });

  test('rejects a patch that fails kernel validation (path traversal)', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'apply_patch', description: 'Evil', readOnly: true, sources: [], proposedPatch: traversalPatch },
    ]);

    assert.throws(
      () => compilePlan(plan, baseContext),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'MALFORMED_ARTIFACT');
        assert.ok(err.message.includes('failed kernel validation'));
        return true;
      },
    );
  });

  test('still rejects apply_patch with no patch payload', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'apply_patch', description: 'No patch', readOnly: true, sources: [] },
    ]);

    assert.throws(
      () => compilePlan(plan, baseContext),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'MALFORMED_TASK_CONTRACT');
        return true;
      },
    );
  });

  test('compiles mixed read + patch plans in order', () => {
    const plan = makePlan([
      { stepId: 's1', action: 'inspect', description: 'Look first', readOnly: true, sources: [] },
      { stepId: 's2', action: 'apply_patch', description: 'Then edit', readOnly: true, sources: [], proposedPatch: validPatch },
      { stepId: 's3', action: 'verify', description: 'Then verify', readOnly: true, sources: [] },
    ]);

    const result = compilePlan(plan, baseContext);

    assert.equal(result.steps.length, 3);
    assert.equal(result.steps[0].action.kind, 'software.inspect');
    assert.equal(result.steps[1].action.kind, 'applyPatch');
    assert.equal(result.steps[2].action.kind, 'software.verify');
  });
});
