import { inspect } from './inspect.js';
import { run } from '../process.js';

/**
 * Software Script Verifier
 *
 * Faithful TypeScript port of the v0.3 seed's verify.mjs.
 * The output shape and status vocabulary are identical so that CLI parity
 * tests pass unchanged.
 *
 * Status vocabulary (must match the seed exactly):
 *   "passed"    – script exited 0
 *   "failed"    – script exited non-zero
 *   "tool_error"– spawn-level error (executable not found, etc.)
 *   "timed_out" – script exceeded its time bound
 */

/**
 * Validates that a script name is safe to pass to a shell.
 * Allows alphanumerics, dots, underscores, colons, and hyphens.
 */
const SAFE_SCRIPT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

/**
 * Runs selected declared npm scripts and reports their results.
 *
 * @param input      Directory containing the project. Defaults to ".".
 * @param requested  Script names to run. When empty, defaults to
 *                   ["check", "test"] filtered to declared scripts.
 * @returns          A verification report identical in shape to the seed.
 */
export async function verify(
  input: string = '.',
  requested: readonly string[] = [],
): Promise<Record<string, unknown>> {
  // 1. Inspect the project to obtain the root and declared scripts.
  const project = (await inspect(input)) as Record<string, unknown>;
  const pkg = project.package as { name: string | null; scripts: Record<string, string> } | null;

  if (!pkg) {
    throw new Error('Verification currently requires a root package.json');
  }

  const scripts = pkg.scripts;

  // 2. Select scripts to run.
  const selected = requested.length
    ? [...requested]
    : ['check', 'test'].filter((name) => Object.hasOwn(scripts, name));

  if (!selected.length) {
    throw new Error('No default checks found; pass --scripts with declared script names');
  }

  // 3. Validate every requested script name.
  for (const name of selected) {
    if (!SAFE_SCRIPT.test(name)) {
      throw new Error(`Unsupported script name: ${name}`);
    }
    if (!Object.hasOwn(scripts, name) || typeof scripts[name] !== 'string') {
      throw new Error(`Script not declared in package.json: ${name}`);
    }
  }

  // 4. Execute each script sequentially.
  const checks: Record<string, unknown>[] = [];

  for (const name of selected) {
    // Windows npm is a .cmd shim; invoke it via cmd.exe with a validated name.
    const executable =
      process.platform === 'win32'
        ? (process.env.ComSpec || 'cmd.exe')
        : 'npm';

    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `npm run ${name}`]
        : ['run', name];

    const result = await run(executable, args, project.root as string);

    // Status vocabulary matches the seed exactly.
    const status = result.timedOut
      ? 'timed_out'
      : result.error
        ? 'tool_error'
        : result.exitCode === 0
          ? 'passed'
          : 'failed';

    checks.push({
      name,
      status,
      ...result,
    });
  }

  // 5. Assemble the report (field order matches the seed).
  return {
    schemaVersion: 1,
    root: project.root,
    generatedAt: new Date().toISOString(),
    passed: checks.every((check) => check.status === 'passed'),
    checks,
  };
}
