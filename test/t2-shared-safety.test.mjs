import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as kernel from '../packages/kernel/dist/index.js';
import * as software from '../packs/software/dist/index.js';

describe('T2 Slice 1: safety machinery is shared and domain-neutral', () => {
  test('kernel exports the worktree safety API', () => {
    assert.equal(typeof kernel.captureWorktreeSnapshot, 'function');
    assert.equal(typeof kernel.diffSnapshots, 'function');
    assert.equal(typeof kernel.evaluateWorktreeSafety, 'function');
    assert.equal(typeof kernel.guardedMutation, 'function');
  });

  test('kernel exports the scoped patch API', () => {
    assert.equal(typeof kernel.validatePatch, 'function');
    assert.equal(typeof kernel.applyPatchOperations, 'function');
    assert.equal(typeof kernel.guardedApplyPatch, 'function');
    assert.equal(typeof kernel.applyPatchWithReport, 'function');
  });

  test('software pack re-exports the same shared implementations', () => {
    // Identity equality proves the software pack is a thin shim over the
    // kernel, not a duplicate implementation.
    assert.equal(software.captureWorktreeSnapshot, kernel.captureWorktreeSnapshot);
    assert.equal(software.guardedMutation, kernel.guardedMutation);
    assert.equal(software.guardedApplyPatch, kernel.guardedApplyPatch);
    assert.equal(software.applyPatchWithReport, kernel.applyPatchWithReport);
  });
});
