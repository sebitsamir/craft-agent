import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { run } from '../src/lib/process.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('parity: inspect with --out writes JSON report to target file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-parity-inspect-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'parity-test', scripts: { test: 'node -v' } }));
    const outPath = join(root, 'report.json');
    const result = await run(process.execPath, [cli, 'inspect', root, '--out', outPath], root);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');

    const written = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(written.schemaVersion, 1);
    assert.equal(written.package?.name, 'parity-test');
    assert.equal(typeof written.generatedAt, 'string');
    assert.ok(Array.isArray(written.inventory.source));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parity: verify with --scripts and --out writes checks report and handles exit codes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-parity-verify-'));
  try {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          passing: 'node -e "process.exit(0)"',
          failing: 'node -e "process.exit(1)"',
        },
      }),
    );
    const outPass = join(root, 'pass.json');
    const passResult = await run(process.execPath, [cli, 'verify', root, '--scripts', 'passing', '--out', outPass], root);
    assert.equal(passResult.exitCode, 0);
    const passReport = JSON.parse(await readFile(outPass, 'utf8'));
    assert.equal(passReport.passed, true);
    assert.equal(passReport.checks.length, 1);
    assert.equal(passReport.checks[0].name, 'passing');
    assert.equal(passReport.checks[0].status, 'passed');

    const outFail = join(root, 'fail.json');
    const failResult = await run(process.execPath, [cli, 'verify', root, '--scripts', 'failing', '--out', outFail], root);
    assert.equal(failResult.exitCode, 1);
    const failReport = JSON.parse(await readFile(outFail, 'utf8'));
    assert.equal(failReport.passed, false);
    assert.equal(failReport.checks[0].status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parity: domains command lists registered metadata and supports --out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-parity-domains-'));
  try {
    const outPath = join(root, 'domains.json');
    const result = await run(process.execPath, [cli, 'domains', '--out', outPath], root);
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(Array.isArray(parsed.domains));
    assert.ok(parsed.domains.some((d) => d.id === 'software' && d.status === 'bootstrap'));
    assert.ok(parsed.domains.some((d) => d.id === 'film' && d.status === 'planned'));

    // domains rejects unexpected path
    const errResult = await run(process.execPath, [cli, 'domains', 'unexpected-path'], root);
    assert.equal(errResult.exitCode, 2);
    assert.match(errResult.stderr, /domains does not take a path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parity: validate-task CLI validates tasks and reflects status codes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-parity-task-'));
  try {
    const validTaskPath = join(root, 'valid-task.json');
    const invalidTaskPath = join(root, 'invalid-task.json');
    const outPath = join(root, 'val-out.json');

    await writeFile(
      validTaskPath,
      JSON.stringify({
        schemaVersion: 1,
        title: 'Simple task',
        intent: 'Validate behavior',
        domain: 'software',
        impact: 'low',
        outputs: [{ kind: 'code', format: 'js', description: 'Sample script' }],
        acceptance: [
          {
            id: 'test',
            statement: 'Runs clean',
            evidence: { method: 'test', description: 'Run test suite' },
          },
        ],
        review: { required: false },
      }),
    );

    const passResult = await run(process.execPath, [cli, 'validate-task', validTaskPath, '--out', outPath], root);
    assert.equal(passResult.exitCode, 0);
    const passReport = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(passReport.valid, true);
    assert.equal(passReport.errors.length, 0);

    // Invalid task (missing acceptance criteria)
    await writeFile(
      invalidTaskPath,
      JSON.stringify({
        schemaVersion: 1,
        title: 'Broken task',
        intent: 'No acceptance',
        domain: 'software',
        impact: 'low',
        outputs: [{ kind: 'code', format: 'js', description: 'Sample' }],
        acceptance: [],
        review: { required: false },
      }),
    );

    const failResult = await run(process.execPath, [cli, 'validate-task', invalidTaskPath], root);
    assert.equal(failResult.exitCode, 1);
    const failReport = JSON.parse(failResult.stdout);
    assert.equal(failReport.valid, false);
    assert.ok(failReport.errors.some((e) => e.includes('acceptance must contain')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parity: CLI argument validation rejects unknown options and missing values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-parity-args-'));
  try {
    // Missing scripts value
    const missingScripts = await run(process.execPath, [cli, 'verify', root, '--scripts'], root);
    assert.equal(missingScripts.exitCode, 2);
    assert.match(missingScripts.stderr, /--scripts needs a value/);

    // Unknown option
    const unknownOpt = await run(process.execPath, [cli, 'inspect', root, '--invalid-option'], root);
    assert.equal(unknownOpt.exitCode, 2);
    assert.match(unknownOpt.stderr, /Unknown option: --invalid-option/);

    // Unknown command outputs usage
    const usageRun = await run(process.execPath, [cli, 'unknown-cmd'], root);
    assert.equal(usageRun.exitCode, 2);
    assert.match(usageRun.stdout, /Usage:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
