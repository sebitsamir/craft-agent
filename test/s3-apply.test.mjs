import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  applyPatchOperations,
  guardedApplyPatch,
} from '../packs/software/dist/index.js';

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function makeDir() {
  return mkdtemp(path.join(tmpdir(), 'craft-s3-apply-'));
}

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'craft-s3-repo-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  await writeFile(path.join(dir, 'existing.txt'), 'initial\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('S3 Slice 2: low-level patch application', () => {
  test('creates, updates, and deletes files within scope', async () => {
    const dir = await makeDir();
    try {
      await writeFile(path.join(dir, 'update-me.txt'), 'old\n');
      await writeFile(path.join(dir, 'delete-me.txt'), 'gone soon\n');

      const patch = {
        schemaVersion: 1,
        patchId: 'p1',
        description: 'test',
        allowedPaths: ['new.txt', 'update-me.txt', 'delete-me.txt'],
        operations: [
          { kind: 'create', path: 'new.txt', content: 'hello\n' },
          { kind: 'update', path: 'update-me.txt', content: 'new\n' },
          { kind: 'delete', path: 'delete-me.txt' },
        ],
      };

      const result = await applyPatchOperations(dir, patch);

      assert.equal(result.appliedOperations, 3);
      assert.deepEqual(result.createdPaths, ['new.txt']);
      assert.deepEqual(result.updatedPaths, ['update-me.txt']);
      assert.deepEqual(result.deletedPaths, ['delete-me.txt']);

      assert.equal(await readFile(path.join(dir, 'new.txt'), 'utf8'), 'hello\n');
      assert.equal(await readFile(path.join(dir, 'update-me.txt'), 'utf8'), 'new\n');
      assert.equal(await exists(path.join(dir, 'delete-me.txt')), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects create when the file already exists', async () => {
    const dir = await makeDir();
    try {
      await writeFile(path.join(dir, 'a.txt'), 'x\n');
      const patch = {
        schemaVersion: 1, patchId: 'p', description: 'd',
        allowedPaths: ['a.txt'],
        operations: [{ kind: 'create', path: 'a.txt', content: 'y' }],
      };
      await assert.rejects(() => applyPatchOperations(dir, patch), /already exists/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects update when the file does not exist', async () => {
    const dir = await makeDir();
    try {
      const patch = {
        schemaVersion: 1, patchId: 'p', description: 'd',
        allowedPaths: ['missing.txt'],
        operations: [{ kind: 'update', path: 'missing.txt', content: 'y' }],
      };
      await assert.rejects(() => applyPatchOperations(dir, patch), /does not exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects delete when the file does not exist', async () => {
    const dir = await makeDir();
    try {
      const patch = {
        schemaVersion: 1, patchId: 'p', description: 'd',
        allowedPaths: ['missing.txt'],
        operations: [{ kind: 'delete', path: 'missing.txt' }],
      };
      await assert.rejects(() => applyPatchOperations(dir, patch), /does not exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a path that escapes the root at apply time', async () => {
    const dir = await makeDir();
    try {
      // Bypass validation and feed an escape path directly to the applicator
      // to prove the apply-time root-escape check works on its own.
      const patch = {
        schemaVersion: 1, patchId: 'p', description: 'd',
        allowedPaths: ['../escape.txt'],
        operations: [{ kind: 'create', path: '../escape.txt', content: 'x' }],
      };
      await assert.rejects(
        () => applyPatchOperations(dir, patch),
        /escapes the repository root/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('S3 Slice 2: guarded patch application', () => {
  test('applies a valid patch on a clean repository', async () => {
    const dir = await makeRepo();
    try {
      const patch = {
        schemaVersion: 1, patchId: 'p-clean', description: 'Add a module',
        allowedPaths: ['src/util.js', 'existing.txt'],
        operations: [
          { kind: 'create', path: 'src/util.js', content: 'export const u = 1;\n' },
          { kind: 'update', path: 'existing.txt', content: 'updated\n' },
        ],
      };

      const res = await guardedApplyPatch(dir, patch);

      assert.equal(res.validated, true);
      assert.equal(res.applied, true);
      assert.equal(res.decision.path, 'clean');
      assert.equal(await exists(path.join(dir, 'src/util.js')), true);
      assert.equal(await readFile(path.join(dir, 'existing.txt'), 'utf8'), 'updated\n');
      // Diff reports the new untracked file and the modified tracked file.
      assert.ok(res.diff.newUntrackedPaths.includes('src/util.js'));
      assert.ok(res.diff.newlyModifiedPaths.includes('existing.txt'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects an invalid patch without touching the filesystem', async () => {
    const dir = await makeRepo();
    try {
      const patch = {
        schemaVersion: 1, patchId: 'p-bad', description: 'Out of scope',
        allowedPaths: ['a.txt'],
        operations: [{ kind: 'create', path: 'OUT-OF-SCOPE.txt', content: 'x' }],
      };

      const res = await guardedApplyPatch(dir, patch);

      assert.equal(res.validated, false);
      assert.equal(res.applied, false);
      assert.ok(res.validationErrors.length > 0);
      assert.equal(await exists(path.join(dir, 'OUT-OF-SCOPE.txt')), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('blocks a valid patch on a dirty repository', async () => {
    const dir = await makeRepo();
    try {
      // Make the worktree dirty with uncommitted work.
      await writeFile(path.join(dir, 'uncommitted.txt'), 'precious\n');

      const patch = {
        schemaVersion: 1, patchId: 'p-dirty', description: 'Try to apply',
        allowedPaths: ['new.txt'],
        operations: [{ kind: 'create', path: 'new.txt', content: 'x\n' }],
      };

      const res = await guardedApplyPatch(dir, patch);

      assert.equal(res.validated, true);
      assert.equal(res.applied, false);
      assert.equal(res.decision.path, 'dirty');
      assert.equal(await exists(path.join(dir, 'new.txt')), false);
      // Uncommitted work is preserved.
      assert.equal(await readFile(path.join(dir, 'uncommitted.txt'), 'utf8'), 'precious\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('applies a valid patch on a dirty repository with explicit consent', async () => {
    const dir = await makeRepo();
    try {
      await writeFile(path.join(dir, 'uncommitted.txt'), 'work\n');

      const patch = {
        schemaVersion: 1, patchId: 'p-consent', description: 'Consented apply',
        allowedPaths: ['new.txt'],
        operations: [{ kind: 'create', path: 'new.txt', content: 'x\n' }],
      };

      const res = await guardedApplyPatch(dir, patch, { allowDirty: true });

      assert.equal(res.validated, true);
      assert.equal(res.applied, true);
      assert.equal(res.decision.path, 'dirty');
      assert.equal(await exists(path.join(dir, 'new.txt')), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
