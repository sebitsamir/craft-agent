import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { makeStepAction } from '../src/lib/actions.mjs';

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function makeGitRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'junub-e2-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "t@e.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "T"', { cwd: dir, stdio: 'ignore' });
  await writeFile(path.join(dir, 'seed.txt'), 'seed\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m seed', { cwd: dir, stdio: 'ignore' });
  return dir;
}

const cleanup = [];
after(async () => { for (const d of cleanup) await rm(d, { recursive: true, force: true }); });

describe('E2 Slice 1: real step actions', () => {
  test('applyPatch action creates a file for real', async () => {
    const dir = await makeGitRepo(); cleanup.push(dir);
    const action = makeStepAction({
      kind: 'applyPatch',
      params: {
        path: dir,
        patch: {
          schemaVersion: 1, patchId: 'p1', description: 'add file',
          allowedPaths: ['new.txt'],
          operations: [{ kind: 'create', path: 'new.txt', content: 'hello\n' }],
        },
      },
    });
    const result = await action({}, 1);
    assert.equal(result.success, true);
    assert.equal(await exists(path.join(dir, 'new.txt')), true);
  });

  test('applyPatch action is blocked on a dirty worktree', async () => {
    const dir = await makeGitRepo(); cleanup.push(dir);
    await writeFile(path.join(dir, 'uncommitted.txt'), 'work\n');
    const action = makeStepAction({
      kind: 'applyPatch',
      params: {
        path: dir,
        patch: {
          schemaVersion: 1, patchId: 'p2', description: 'x',
          allowedPaths: ['other.txt'],
          operations: [{ kind: 'create', path: 'other.txt', content: 'x\n' }],
        },
      },
    });
    const result = await action({}, 1);
    assert.equal(result.success, false);
    assert.equal(result.failureCategory, 'POLICY_BLOCKED');
    assert.equal(await exists(path.join(dir, 'other.txt')), false);
  });

  test('film.applyPatch rejects media-targeting patches', async () => {
    const dir = await makeGitRepo(); cleanup.push(dir);
    await writeFile(path.join(dir, 'shot.mp4'), 'bytes');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m media', { cwd: dir, stdio: 'ignore' });
    const action = makeStepAction({
      kind: 'film.applyPatch',
      params: {
        path: dir,
        patch: {
          schemaVersion: 1, patchId: 'p3', description: 'x',
          allowedPaths: ['shot.mp4'],
          operations: [{ kind: 'update', path: 'shot.mp4', content: 'x' }],
        },
      },
    });
    const result = await action({}, 1);
    assert.equal(result.success, false);
    assert.equal(result.failureCategory, 'POLICY_BLOCKED');
  });

  test('unknown action kind reports UNSUPPORTED', async () => {
    const action = makeStepAction({ kind: 'bogus', params: {} });
    const result = await action({}, 1);
    assert.equal(result.success, false);
    assert.equal(result.failureCategory, 'UNSUPPORTED');
  });
});