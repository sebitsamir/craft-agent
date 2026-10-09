import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  evaluateWorktreeSafety,
  guardedMutation,
} from '../packs/software/dist/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a snapshot object directly for pure decision-logic tests. */
function makeSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    root: '/tmp/repo',
    capturedAt: new Date().toISOString(),
    isGitRepository: true,
    branch: 'main',
    headCommit: 'a'.repeat(40),
    isDirty: false,
    changedPaths: [],
    untrackedPaths: [],
    ...overrides,
  };
}

/** Creates a fresh temporary Git repository with one committed file. */
async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'junub-s2-gate-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  await writeFile(path.join(dir, 'tracked.txt'), 'initial\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

/** Returns true when a file exists. */
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------

describe('S2 Slice 3: safety gate decision logic', () => {
  test('clean snapshot is allowed on the clean path', () => {
    const decision = evaluateWorktreeSafety(makeSnapshot());
    assert.equal(decision.allowed, true);
    assert.equal(decision.path, 'clean');
    assert.equal(decision.atRiskPaths.length, 0);
  });

  test('dirty snapshot is blocked by default', () => {
    const snap = makeSnapshot({
      isDirty: true,
      changedPaths: ['src/app.ts'],
      untrackedPaths: ['notes.md'],
    });
    const decision = evaluateWorktreeSafety(snap);

    assert.equal(decision.allowed, false);
    assert.equal(decision.path, 'dirty');
    assert.ok(decision.atRiskPaths.includes('src/app.ts'));
    assert.ok(decision.atRiskPaths.includes('notes.md'));
  });

  test('dirty snapshot is allowed with explicit consent', () => {
    const snap = makeSnapshot({ isDirty: true, untrackedPaths: ['notes.md'] });
    const decision = evaluateWorktreeSafety(snap, { allowDirty: true });

    assert.equal(decision.allowed, true);
    assert.equal(decision.path, 'dirty');
    assert.ok(decision.atRiskPaths.includes('notes.md'));
  });

  test('non-git snapshot is allowed on the non-git path', () => {
    const snap = makeSnapshot({ isGitRepository: false });
    const decision = evaluateWorktreeSafety(snap);

    assert.equal(decision.allowed, true);
    assert.equal(decision.path, 'non-git');
  });
});

// ---------------------------------------------------------------------------
// Real-git guarded mutation loop
// ---------------------------------------------------------------------------

describe('S2 Slice 3: guarded mutation on real repositories', () => {
  test('clean path applies the mutation without overwrite', async () => {
    const dir = await makeRepo();
    try {
      const targetPath = path.join(dir, 'generated.txt');

      const res = await guardedMutation(dir, async () => {
        await writeFile(targetPath, 'generated\n');
        return 'done';
      });

      assert.equal(res.applied, true, 'Gate must allow a clean worktree');
      assert.equal(res.decision.path, 'clean');
      assert.equal(res.result, 'done');
      assert.equal(await exists(targetPath), true, 'Mutation must have run');
      assert.ok(res.diff.newUntrackedPaths.includes('generated.txt'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dirty path preserves work and refuses to apply', async () => {
    const dir = await makeRepo();
    try {
      // Introduce uncommitted work.
      await writeFile(path.join(dir, 'uncommitted.txt'), 'precious work\n');

      const targetPath = path.join(dir, 'generated.txt');
      let mutateRan = false;

      const res = await guardedMutation(dir, async () => {
        mutateRan = true;
        await writeFile(targetPath, 'generated\n');
        return 'done';
      });

      assert.equal(res.applied, false, 'Gate must block a dirty worktree');
      assert.equal(res.decision.path, 'dirty');
      assert.equal(mutateRan, false, 'Mutation must not have run');
      assert.equal(await exists(targetPath), false, 'No new file should be created');
      assert.ok(res.decision.atRiskPaths.includes('uncommitted.txt'));

      // The uncommitted work is still intact.
      const preserved = await readFile(path.join(dir, 'uncommitted.txt'), 'utf8');
      assert.equal(preserved, 'precious work\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dirty path with explicit consent applies the mutation', async () => {
    const dir = await makeRepo();
    try {
      await writeFile(path.join(dir, 'uncommitted.txt'), 'work\n');

      const targetPath = path.join(dir, 'generated.txt');
      const res = await guardedMutation(
        dir,
        async () => {
          await writeFile(targetPath, 'generated\n');
          return 'done';
        },
        { allowDirty: true },
      );

      assert.equal(res.applied, true);
      assert.equal(res.decision.path, 'dirty');
      assert.equal(await exists(targetPath), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
