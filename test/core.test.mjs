import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspect } from '../src/lib/inspect.mjs';
import { verify } from '../src/lib/verify.mjs';
import { run } from '../src/lib/process.mjs';

test('inspect counts source and tests while excluding dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junub-agent-'));
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --version' } }));
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;');
    await writeFile(join(root, 'src', 'app.test.ts'), 'export const test = 1;');
    await writeFile(join(root, 'node_modules', 'noise.js'), '');
    const report = await inspect(root);
    assert.equal(report.inventory.total, 3);
    assert.deepEqual(report.inventory.tests, ['src/app.test.ts']);
    assert.equal(report.inventory.source.includes('node_modules/noise.js'), false);
    assert.equal(report.package.name, 'fixture');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verify runs declared scripts and rejects undeclared scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junub-agent-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"', test: 'node -e "process.exit(1)"' } }));
    const success = await verify(root, ['check']);
    assert.equal(success.passed, true);
    const failure = await verify(root, ['test']);
    assert.equal(failure.passed, false);
    await assert.rejects(() => verify(root, ['install']), /not declared/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('malformed manifests fail loudly instead of appearing absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junub-agent-'));
  try {
    await writeFile(join(root, 'package.json'), '{"scripts":');
    await assert.rejects(() => inspect(root), /Invalid package.json/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('timeout reports a non-passing check and bounded output stays bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junub-agent-'));
  try {
    const result = await run(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000)); setInterval(() => {}, 1000)'], root, { timeoutMs: 500, maxOutputBytes: 128 });
    assert.equal(result.timedOut, true);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 128);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Git inspection preserves spaces and both paths of a staged rename', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'junub-agent-git-'));
  try {
    const initialized = await run('git', ['init', '-q'], root);
    if (initialized.error || initialized.exitCode !== 0) { t.skip('Git is not installed'); return; }
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --version' } }));
    await writeFile(join(root, 'old name.ts'), 'export const value = 1;');
    assert.equal((await run('git', ['add', '.'], root)).exitCode, 0);
    assert.equal((await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], root)).exitCode, 0);
    assert.equal((await run('git', ['mv', 'old name.ts', 'new name.ts'], root)).exitCode, 0);
    const report = await inspect(root);
    assert.equal(report.git.available, true);
    assert.equal(report.git.dirty, true);
    assert.deepEqual(report.git.changedPaths, ['new name.ts', 'old name.ts']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI rejects a missing option value instead of writing to a flag-shaped path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'junub-agent-cli-'));
  try {
    const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
    const result = await run(process.execPath, [cli, 'inspect', root, '--out', '--scripts', 'test'], root);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--out needs a value/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
