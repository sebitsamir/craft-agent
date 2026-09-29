import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { domains } from '../src/lib/domains.mjs';
import { validateTask } from '../src/lib/task-contract.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

test('architecture: only a single pnpm lockfile exists', async () => {
  const rootFiles = await readdir(rootDir);
  assert.ok(rootFiles.includes('pnpm-lock.yaml'), 'pnpm-lock.yaml must exist');
  assert.ok(!rootFiles.includes('package-lock.json'), 'package-lock.json must not exist');
  assert.ok(!rootFiles.includes('yarn.lock'), 'yarn.lock must not exist');
  assert.ok(!rootFiles.includes('bun.lockb'), 'bun.lockb must not exist');
});

test('architecture: packages directory contains no empty placeholder packages', async () => {
  const packagesDir = join(rootDir, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packageDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  assert.ok(packageDirs.length > 0, 'At least one package should exist');

  for (const pkgName of packageDirs) {
    const pkgPath = join(packagesDir, pkgName);
    const manifestPath = join(pkgPath, 'package.json');
    const srcPath = join(pkgPath, 'src');

    // Must have package.json
    const manifestStat = await stat(manifestPath);
    assert.ok(manifestStat.isFile(), `${pkgName} must have package.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.ok(manifest.name, `${pkgName} package.json must have a name`);

    // Must have non-empty src directory
    const srcEntries = await readdir(srcPath);
    assert.ok(srcEntries.length > 0, `${pkgName}/src must not be empty`);
  }
});

test('architecture: domain registry adheres to identifier constraints and unique IDs', () => {
  const DOMAIN_ID = /^[a-z][a-z0-9-]{1,63}$/;
  const ids = new Set();
  for (const domain of domains) {
    assert.match(domain.id, DOMAIN_ID, `Domain ID ${domain.id} must be valid identifier`);
    assert.ok(!ids.has(domain.id), `Domain ID ${domain.id} must be unique`);
    ids.add(domain.id);
    assert.ok(['bootstrap', 'planned', 'active'].includes(domain.status), `Domain ${domain.id} has valid status`);
    assert.ok(Array.isArray(domain.exampleOutputs) && domain.exampleOutputs.length > 0, `Domain ${domain.id} has example outputs`);
  }
});

test('architecture: all committed example tasks validate against task contract', async () => {
  const examplesDir = join(rootDir, 'examples');
  const files = await readdir(examplesDir);
  const taskFiles = files.filter((f) => f.endsWith('-task.json'));

  assert.ok(taskFiles.length >= 2, 'Should have at least 2 example tasks');

  for (const file of taskFiles) {
    const content = JSON.parse(await readFile(join(examplesDir, file), 'utf8'));
    const result = validateTask(content);
    assert.equal(result.valid, true, `Example task ${file} must be valid`);
  }
});

test('architecture: root package.json defines required scripts and zero production dependencies', async () => {
  const manifest = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined, 'Seed must have zero runtime production dependencies');
  assert.ok(manifest.scripts.test, 'Must define test script');
  assert.ok(manifest.scripts.check, 'Must define check script');
  assert.ok(manifest.scripts.build, 'Must define build script');
});
