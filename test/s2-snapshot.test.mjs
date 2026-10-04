import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { captureWorktreeSnapshot } from '../packs/software/dist/index.js';

describe('S2 Slice 1: Worktree snapshot capture', () => {
  let tempDir;

  before(async () => {
    // Build a real Git repository with one committed file.
    tempDir = await mkdtemp(path.join(tmpdir(), 'craft-s2-snapshot-'));
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
    await writeFile(path.join(tempDir, 'tracked.txt'), 'initial\n');
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
  });

  after(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('captures a clean worktree as not dirty', async () => {
    const snap = await captureWorktreeSnapshot(tempDir);

    assert.equal(snap.isGitRepository, true, 'Must detect the Git repository');
    assert.equal(snap.branch, 'main', 'Must report the current branch');
    assert.ok(snap.headCommit && snap.headCommit.length === 40, 'Must report a 40-char HEAD SHA');
    assert.equal(snap.isDirty, false, 'A fresh commit must be clean');
    assert.equal(snap.changedPaths.length, 0);
    assert.equal(snap.untrackedPaths.length, 0);
  });

  test('captures modified and untracked files as dirty', async () => {
    // Mutate a tracked file and add an untracked file.
    await writeFile(path.join(tempDir, 'tracked.txt'), 'modified\n');
    await writeFile(path.join(tempDir, 'untracked.txt'), 'new\n');

    const snap = await captureWorktreeSnapshot(tempDir);

    assert.equal(snap.isDirty, true, 'Worktree with changes must be dirty');
    assert.ok(snap.changedPaths.includes('tracked.txt'), 'Must list the modified file');
    assert.ok(snap.untrackedPaths.includes('untracked.txt'), 'Must list the untracked file');
  });

  test('reports a non-Git directory as not a repository', async () => {
    const nonGit = await mkdtemp(path.join(tmpdir(), 'craft-s2-nongit-'));
    try {
      const snap = await captureWorktreeSnapshot(nonGit);
      assert.equal(snap.isGitRepository, false);
      assert.equal(snap.isDirty, false);
      assert.equal(snap.changedPaths.length, 0);
      assert.equal(snap.untrackedPaths.length, 0);
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});
