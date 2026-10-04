import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectFilmProject, verifyMediaLinks } from '../packs/film/dist/index.js';

describe('T0 Slice 2: Film inspection and media link verification', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'junub-t0-film-checks-'));
    await mkdir(path.join(tempDir, 'media'), { recursive: true });
    await mkdir(path.join(tempDir, 'timelines'), { recursive: true });

    // Create a mock EDL timeline referencing two clips
    const edlContent = `TITLE:   TEST CUT
FCM: NON-DROP FRAME
001  AX       V     C        00:00:00:00 00:00:05:00 01:00:00:00 01:00:05:00
* FROM CLIP NAME:  SHOT_01.MP4
002  AX       V     C        00:00:05:00 00:00:10:00 01:00:05:00 01:00:10:00
* FROM CLIP NAME:  MISSING_SHOT.MOV
`;
    await writeFile(path.join(tempDir, 'timelines', 'cut.edl'), edlContent);

    // Create one existing media file, leave the other missing
    await writeFile(path.join(tempDir, 'media', 'SHOT_01.MP4'), 'fake video data');
  });

  after(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test('inspectFilmProject parses EDL and extracts referenced clips', async () => {
    const report = await inspectFilmProject(tempDir);

    assert.equal(report.timelines.length, 1);
    assert.equal(report.timelines[0].format, 'edl');
    assert.equal(report.timelines[0].referencedClips.length, 2);
    assert.ok(report.timelines[0].referencedClips.includes('SHOT_01.MP4'));
    assert.ok(report.timelines[0].referencedClips.includes('MISSING_SHOT.MOV'));
  });

  test('verifyMediaLinks detects missing media assets', async () => {
    const report = await verifyMediaLinks(tempDir);

    assert.equal(report.passed, false, 'Must fail when media is missing');
    assert.equal(report.checks.length, 2);

    const linkedCheck = report.checks.find(c => c.clipName === 'SHOT_01.MP4');
    assert.equal(linkedCheck.status, 'linked');

    const missingCheck = report.checks.find(c => c.clipName === 'MISSING_SHOT.MOV');
    assert.equal(missingCheck.status, 'missing');
  });
});
