import { inspect } from './inspect.mjs';
import { run } from './process.mjs';

const SAFE_SCRIPT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

export async function verify(input = '.', requested = []) {
  const project = await inspect(input);
  if (!project.package) throw new Error('Verification currently requires a root package.json');
  const scripts = project.package.scripts;
  // Build/lint can be expensive or modify generated files. Explicitly opt in.
  const selected = requested.length ? requested : ['check', 'test'].filter((name) => Object.hasOwn(scripts, name));
  if (!selected.length) throw new Error('No default checks found; pass --scripts with declared script names');
  for (const name of selected) {
    if (!SAFE_SCRIPT.test(name)) throw new Error(`Unsupported script name: ${name}`);
    if (!Object.hasOwn(scripts, name) || typeof scripts[name] !== 'string') {
      throw new Error(`Script not declared in package.json: ${name}`);
    }
  }
  const checks = [];
  for (const name of selected) {
    // Windows npm is a .cmd shim; invoke it via cmd.exe with a validated name.
    const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', `npm run ${name}`] : ['run', name];
    const result = await run(executable, args, project.root);
    checks.push({
      name,
      status: result.timedOut ? 'timed_out' : result.error ? 'tool_error' : result.exitCode === 0 ? 'passed' : 'failed',
      ...result,
    });
  }
  return { schemaVersion: 1, root: project.root, generatedAt: new Date().toISOString(), passed: checks.every((check) => check.status === 'passed'), checks };
}
