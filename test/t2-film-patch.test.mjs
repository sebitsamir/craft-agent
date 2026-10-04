import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { applyFilmPatch } from '../packs/film/dist/index.js';

async function makeFilmRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'junub-t2-film-patch-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "t@e.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "T"', { cwd: dir, stdio: 'ignore' });
  await mkdir(path.join(dir, 'media'), { recursive: true });
  await mkdir(path.join(dir, 'timelines'), { recursive: true });
  await writeFile(path.join(dir, 'media', 'shot_01.mp4'), 'video-bytes');
  await writeFile(path.join(dir, 'timelines', 'cut.edl'), '* FROM CLIP NAME:  shot_01.mp4\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "seed"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

const cleanup = [];
after(async () => {
  for (const dir of cleanup) await rm(dir, { recursive: true, force: true });
});

describe('T2 Slice 2: film scoped patching', () => {
  test('applies a timeline patch under the gate with hash-bound artifact', async () => {
    const dir = await makeFilmRepo(); cleanup.push(dir);
    const patch = {
      schemaVersion: 1, patchId: 'p-edl', description: 'update edl',
      allowedPaths: ['timelines/cut.edl'],
      operations: [{ kind: 'update', path: 'timelines/cut.edl', content: '* FROM CLIP NAME:  shot_01.mp4\n* extra\n' }],
    };
    const report = await applyFilmPatch(dir, patch);

    assert.equal(report.scopeViolation, false);
    assert.equal(report.applied, true);
    assert.equal(report.artifacts.length, 1);
    assert.equal(report.artifacts[0].operation, 'updated');
    assert.equal(report.mediaLinksPassed, true, 'Media links must still hold');
  });

  test('rejects a patch that targets an existing media asset', async () => {
    const dir = await makeFilmRepo(); cleanup.push(dir);
    const patch = {
      schemaVersion: 1, patchId: 'p-media', description: 'try to patch media',
      allowedPaths: ['media/shot_01.mp4'],
      operations: [{ kind: 'update', path: 'media/shot_01.mp4', content: 'tampered' }],
    };
    const report = await applyFilmPatch(dir, patch);

    assert.equal(report.scopeViolation, true);
    assert.equal(report.applied, false);
    const content = await readFile(path.join(dir, 'media', 'shot_01.mp4'), 'utf8');
    assert.equal(content, 'video-bytes', 'Media must be untouched');
  });

  test('rejects a patch that creates a new media asset', async () => {
    const dir = await makeFilmRepo(); cleanup.push(dir);
    const patch = {
      schemaVersion: 1, patchId: 'p-newmedia', description: 'try to create media',
      allowedPaths: ['media/new.mp4'],
      operations: [{ kind: 'create', path: 'media/new.mp4', content: 'x' }],
    };
    const report = await applyFilmPatch(dir, patch);

    assert.equal(report.scopeViolation, true);
    assert.equal(report.applied, false);
  });

  test('blocks a valid timeline patch on a dirty worktree', async () => {
    const dir = await makeFilmRepo(); cleanup.push(dir);
    await writeFile(path.join(dir, 'uncommitted.txt'), 'work');

    const patch = {
      schemaVersion: 1, patchId: 'p-dirty', description: 'update edl on dirty',
      allowedPaths: ['timelines/cut.edl'],
      operations: [{ kind: 'update', path: 'timelines/cut.edl', content: 'changed\n' }],
    };
    const report = await applyFilmPatch(dir, patch);

    assert.equal(report.scopeViolation, false);
    assert.equal(report.applied, false, 'Gate must block dirty worktree');
  });

  test('reports broken media links after a patch that removes a reference', async () => {
    const dir = await makeFilmRepo(); cleanup.push(dir);
    const patch = {
      schemaVersion: 1, patchId: 'p-break', description: 'reference a missing clip',
      allowedPaths: ['timelines/cut.edl'],
      operations: [{ kind: 'update', path: 'timelines/cut.edl', content: '* FROM CLIP NAME:  ghost.mov\n' }],
    };
    const report = await applyFilmPatch(dir, patch);

    assert.equal(report.applied, true);
    assert.equal(report.mediaLinksPassed, false);
    assert.ok(report.missingMedia.includes('ghost.mov'));
  });
});
