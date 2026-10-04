import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  loadFilmPackManifest,
  mapFilmProject,
} from '../packs/film/dist/index.js';

describe('T0 Slice 1: Film pack foundation and project mapper', () => {
  let tempDir;

  before(async () => {
    // 1. Create a temporary directory for our film fixture
    tempDir = await mkdtemp(path.join(tmpdir(), 'junub-t0-film-'));

    // 2. Initialize a Git repository (simulating a film project under version control)
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });

    // 3. Create a mock film project structure
    await mkdir(path.join(tempDir, 'media', 'video'), { recursive: true });
    await mkdir(path.join(tempDir, 'media', 'audio'), { recursive: true });
    await mkdir(path.join(tempDir, 'timelines'), { recursive: true });
    await mkdir(path.join(tempDir, 'script'), { recursive: true });

    // Script
    await writeFile(path.join(tempDir, 'script', 'screenplay.fountain'), 'EXT. SPACE - DAY\n');

    // Timelines
    await writeFile(path.join(tempDir, 'timelines', 'rough_cut.edl'), 'TITLE: Rough Cut\n');
    await writeFile(path.join(tempDir, 'timelines', 'final.xml'), '<?xml version="1.0"?>\n');

    // Media Assets
    await writeFile(path.join(tempDir, 'media', 'video', 'shot_01.mp4'), 'fake video data');
    await writeFile(path.join(tempDir, 'media', 'audio', 'dialogue.wav'), 'fake audio data');
    await writeFile(path.join(tempDir, 'media', 'video', 'vfx_shot.exr'), 'fake exr data');

    // Project File (Premiere)
    await writeFile(path.join(tempDir, 'Project.prproj'), 'fake premiere project');
  });

  after(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('film pack manifest loads and validates successfully', () => {
    const manifest = loadFilmPackManifest();

    assert.equal(manifest.id, 'film-pack');
    assert.equal(manifest.domain, 'film');
    assert.equal(manifest.status, 'available');

    const inspectAction = manifest.actions.find(a => a.name === 'inspect');
    assert.ok(inspectAction, 'Film pack must define an inspect action.');

    const verifyAction = manifest.actions.find(a => a.name === 'verify');
    assert.ok(verifyAction, 'Film pack must define a verify action.');
  });

  test('project mapper correctly categorizes film assets', () => {
    const project = mapFilmProject(tempDir);

    assert.equal(project.isGitRepository, true, 'Must detect Git repository');
    assert.equal(project.projectType, 'premiere', 'Must detect Premiere project file');

    // Scripts
    assert.equal(project.scripts.length, 1);
    assert.ok(project.scripts[0].includes('screenplay.fountain'));

    // Timelines
    assert.equal(project.timelines.length, 2);
    assert.ok(project.timelines.some(t => t.includes('rough_cut.edl')));
    assert.ok(project.timelines.some(t => t.includes('final.xml')));

    // Media Assets
    assert.equal(project.mediaAssets.length, 3);
    assert.ok(project.mediaAssets.some(m => m.includes('shot_01.mp4')));
    assert.ok(project.mediaAssets.some(m => m.includes('dialogue.wav')));
    assert.ok(project.mediaAssets.some(m => m.includes('vfx_shot.exr')));

    // Project Files
    assert.equal(project.projectFiles.length, 1);
    assert.ok(project.projectFiles[0].includes('Project.prproj'));
  });
});
