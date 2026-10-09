import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  captureWorktreeSnapshot,
  diffSnapshots,
} from '../packs/software/dist/index.js';

/**
 * Builds a snapshot object directly so we can test the pure diff logic
 * without touching the filesystem or git.
 */
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

describe('S2 Slice 2: Snapshot diff comparator', () => {
  test('identical snapshots report identical', () => {
    const before = makeSnapshot();
    const after = makeSnapshot();
    const diff = diffSnapshots(before, after);

    assert.equal(diff.identical, true);
    assert.equal(diff.branchMoved, false);
    assert.equal(diff.headMoved, false);
    assert.equal(diff.newlyModifiedPaths.length, 0);
    assert.equal(diff.resolvedPaths.length, 0);
    assert.equal(diff.newUntrackedPaths.length, 0);
    assert.equal(diff.goneUntrackedPaths.length, 0);
  });

  test('detects a newly modified tracked file', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({ changedPaths: ['src/app.ts'], isDirty: true });
    const diff = diffSnapshots(before, after);

    assert.equal(diff.identical, false);
    assert.deepEqual(diff.newlyModifiedPaths, ['src/app.ts']);
    assert.equal(diff.resolvedPaths.length, 0);
  });

  test('detects a resolved tracked file (committed or reverted)', () => {
    const before = makeSnapshot({ changedPaths: ['src/app.ts'], isDirty: true });
    const after = makeSnapshot();
    const diff = diffSnapshots(before, after);

    assert.deepEqual(diff.resolvedPaths, ['src/app.ts']);
    assert.equal(diff.newlyModifiedPaths.length, 0);
  });

  test('detects a new untracked artifact', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({ untrackedPaths: ['build/output.js'], isDirty: true });
    const diff = diffSnapshots(before, after);

    assert.deepEqual(diff.newUntrackedPaths, ['build/output.js']);
    assert.equal(diff.goneUntrackedPaths.length, 0);
  });

  test('detects a deleted untracked artifact', () => {
    const before = makeSnapshot({ untrackedPaths: ['notes.md'], isDirty: true });
    const after = makeSnapshot();
    const diff = diffSnapshots(before, after);

    assert.deepEqual(diff.goneUntrackedPaths, ['notes.md']);
    assert.equal(diff.newUntrackedPaths.length, 0);
  });

  test('detects HEAD and branch movement', () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      branch: 'feature/x',
      headCommit: 'b'.repeat(40),
    });
    const diff = diffSnapshots(before, after);

    assert.equal(diff.branchMoved, true);
    assert.equal(diff.headMoved, true);
    assert.equal(diff.identical, false);
  });

  test('refuses to diff snapshots from different roots', () => {
    const before = makeSnapshot({ root: '/tmp/repo-a' });
    const after = makeSnapshot({ root: '/tmp/repo-b' });

    assert.throws(
      () => diffSnapshots(before, after),
      /different roots/,
    );
  });
});

describe('S2 Slice 2: real-git before/after diff', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'junub-s2-diff-'));
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
    await writeFile(path.join(tempDir, 'tracked.txt'), 'initial\n');
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
  });

  after(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test('captures before, mutates, captures after, and diffs', async () => {
    const before = await captureWorktreeSnapshot(tempDir);
    assert.equal(before.isDirty, false, 'Precondition: worktree starts clean');

    // Mutate: edit a tracked file and add an untracked artifact.
    await writeFile(path.join(tempDir, 'tracked.txt'), 'changed\n');
    await writeFile(path.join(tempDir, 'generated.log'), 'log\n');

    const after = await captureWorktreeSnapshot(tempDir);
    const diff = diffSnapshots(before, after);

    assert.equal(diff.identical, false);
    assert.deepEqual(diff.newlyModifiedPaths, ['tracked.txt']);
    assert.deepEqual(diff.newUntrackedPaths, ['generated.log']);
    assert.equal(diff.headMoved, false, 'No commit happened, HEAD must not move');
  });
});
