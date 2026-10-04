import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validatePatch } from '../packs/software/dist/index.js';

/**
 * Builds a valid patch so individual tests can override one field at a time.
 */
function makePatch(overrides = {}) {
  return {
    schemaVersion: 1,
    patchId: 'patch-001',
    description: 'Test patch',
    allowedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    operations: [
      { kind: 'create', path: 'src/a.ts', content: 'export const a = 1;\n' },
      { kind: 'update', path: 'src/b.ts', content: 'export const b = 2;\n' },
      { kind: 'delete', path: 'src/c.ts' },
    ],
    ...overrides,
  };
}

describe('S3 Slice 1: patch model validation', () => {
  test('accepts a valid patch with create, update, and delete in scope', () => {
    const result = validatePatch(makePatch());
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  test('rejects an unsupported schemaVersion', () => {
    const result = validatePatch(makePatch({ schemaVersion: 2 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('schemaVersion')));
  });

  test('rejects an empty patchId', () => {
    const result = validatePatch(makePatch({ patchId: '' }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('patchId')));
  });

  test('rejects empty allowedPaths', () => {
    const result = validatePatch(makePatch({ allowedPaths: [] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('allowedPaths')));
  });

  test('rejects empty operations', () => {
    const result = validatePatch(makePatch({ operations: [] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('operations')));
  });

  test('rejects an unknown operation kind', () => {
    const result = validatePatch(makePatch({
      operations: [{ kind: 'rename', path: 'src/a.ts', content: 'x' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('kind')));
  });

  test('rejects a delete operation that carries content', () => {
    const result = validatePatch(makePatch({
      operations: [{ kind: 'delete', path: 'src/c.ts', content: 'should not be here' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('delete')));
  });

  test('rejects a create operation without content', () => {
    const result = validatePatch(makePatch({
      operations: [{ kind: 'create', path: 'src/a.ts' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('content')));
  });

  test('rejects an operation targeting a path outside allowedPaths', () => {
    const result = validatePatch(makePatch({
      operations: [{ kind: 'update', path: 'src/out-of-scope.ts', content: 'x' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('outside the declared allowedPaths')));
  });

  test('rejects absolute paths', () => {
    const result = validatePatch(makePatch({
      allowedPaths: ['/etc/passwd'],
      operations: [{ kind: 'update', path: '/etc/passwd', content: 'x' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('absolute')));
  });

  test('rejects path traversal', () => {
    const result = validatePatch(makePatch({
      allowedPaths: ['../secrets.txt'],
      operations: [{ kind: 'update', path: '../secrets.txt', content: 'x' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('traversal')));
  });

  test('rejects a non-object patch', () => {
    const result = validatePatch(null);
    assert.equal(result.valid, false);
  });
});
