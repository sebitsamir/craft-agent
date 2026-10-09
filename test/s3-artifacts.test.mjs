import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { applyPatchWithReport } from '../packs/software/dist/index.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** Creates a git repo with a few committed seed files. */
async function makeSeededRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'junub-s3-art-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  await writeFile(path.join(dir, 'update-me.txt'), 'old-content\n');
  await writeFile(path.join(dir, 'delete-me.txt'), 'to-be-deleted\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "seed"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function makePatch() {
  return {
    schemaVersion: 1,
    patchId: 'p-artifacts',
    description: 'Create, update, and delete with hash binding',
    allowedPaths: ['created.txt', 'update-me.txt', 'delete-me.txt'],
    operations: [
      { kind: 'create', path: 'created.txt', content: 'brand-new\n' },
      { kind: 'update', path: 'update-me.txt', content: 'fresh-content\n' },
      { kind: 'delete', path: 'delete-me.txt' },
    ],
  };
}

describe('S3 Slice 3: hash-bound artifact reporting', () => {
  test('records hash-bound artifacts for create, update, and delete', async () => {
    const dir = await makeSeededRepo();
    try {
      const report = await applyPatchWithReport(dir, makePatch());

      assert.equal(report.validated, true);
      assert.equal(report.applied, true);
      assert.equal(report.decision.path, 'clean');
      assert.equal(report.artifacts.length, 3);

      // Created file: hash matches new content.
      const created = report.artifacts.find((a) => a.path === 'created.txt');
      assert.equal(created.operation, 'created');
      assert.equal(created.sha256, sha256('brand-new\n'));
      assert.equal(created.sizeBytes, Buffer.byteLength('brand-new\n'));
      assert.equal(created.previousSha256, undefined);

      // Updated file: hash matches new content, previous hash matches old.
      const updated = report.artifacts.find((a) => a.path === 'update-me.txt');
      assert.equal(updated.operation, 'updated');
      assert.equal(updated.sha256, sha256('fresh-content\n'));
      assert.equal(updated.previousSha256, sha256('old-content\n'));

      // Deleted file: no new hash, previous hash captured before removal.
      const deleted = report.artifacts.find((a) => a.path === 'delete-me.txt');
      assert.equal(deleted.operation, 'deleted');
      assert.equal(deleted.sha256, null);
      assert.equal(deleted.sizeBytes, 0);
      assert.equal(deleted.previousSha256, sha256('to-be-deleted\n'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('artifact hash is verifiable by re-reading the file', async () => {
    const dir = await makeSeededRepo();
    try {
      const report = await applyPatchWithReport(dir, makePatch());
      const created = report.artifacts.find((a) => a.path === 'created.txt');

      // Re-read the file independently and re-hash; it must match.
      const reread = await readFile(path.join(dir, 'created.txt'));
      const rereadHash = createHash('sha256').update(reread).digest('hex');
      assert.equal(rereadHash, created.sha256);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('artifact hash detects post-application tampering', async () => {
    const dir = await makeSeededRepo();
    try {
      const report = await applyPatchWithReport(dir, makePatch());
      const created = report.artifacts.find((a) => a.path === 'created.txt');

      // Tamper with the file behind the agent's back.
      await writeFile(path.join(dir, 'created.txt'), 'tampered\n');

      const reread = await readFile(path.join(dir, 'created.txt'));
      const rereadHash = createHash('sha256').update(reread).digest('hex');
      assert.notEqual(rereadHash, created.sha256, 'Tampering must break the hash binding');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('invalid patch returns validated=false with no artifacts', async () => {
    const dir = await makeSeededRepo();
    try {
      const badPatch = {
        schemaVersion: 1, patchId: 'p-bad', description: 'Out of scope',
        allowedPaths: ['a.txt'],
        operations: [{ kind: 'create', path: 'OUT-OF-SCOPE.txt', content: 'x' }],
      };
      const report = await applyPatchWithReport(dir, badPatch);

      assert.equal(report.validated, false);
      assert.equal(report.applied, false);
      assert.equal(report.artifacts.length, 0);
      assert.ok(report.validationErrors.length > 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dirty worktree is blocked with no artifacts', async () => {
    const dir = await makeSeededRepo();
    try {
      // Introduce uncommitted work.
      await writeFile(path.join(dir, 'uncommitted.txt'), 'precious\n');

      const report = await applyPatchWithReport(dir, makePatch());

      assert.equal(report.validated, true);
      assert.equal(report.applied, false);
      assert.equal(report.decision.path, 'dirty');
      assert.equal(report.artifacts.length, 0);
      assert.equal(await exists(path.join(dir, 'created.txt')), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('report includes before and after snapshots with a diff', async () => {
    const dir = await makeSeededRepo();
    try {
      const report = await applyPatchWithReport(dir, makePatch());

      assert.ok(report.before, 'Report must include a before snapshot');
      assert.ok(report.after, 'Report must include an after snapshot');
      assert.ok(report.diff, 'Report must include a diff');
      assert.equal(report.before.isDirty, false);
      assert.ok(report.diff.newUntrackedPaths.includes('created.txt'));
      assert.ok(report.diff.newlyModifiedPaths.includes('update-me.txt'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
