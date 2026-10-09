import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { parse } from 'node:path';

/**
 * Runs a known executable. Captures bounded stdout/stderr and
 * terminates the process tree after the timeout.
 *
 * When `shell: true` is passed in options, the command and args are joined
 * into a single string to avoid Node.js DEP0190 warnings and allow
 * execution of .cmd scripts (like npm/pnpm) on Windows.
 *
 * @param {string} executable - The command to run.
 * @param {string[]} args - The arguments to pass.
 * @param {string} cwd - The working directory.
 * @param {object} options - Execution options.
 * @returns {Promise<object>} The execution result.
 */
export async function run(executable, args, cwd, options = {}) {
  const { timeoutMs = 120000, maxOutputBytes = 65536, shell = false } = options;

  return new Promise((done) => {
    const started = Date.now();
    let child;
    const stdoutChunks = [];
    const stderrChunks = [];
    let capturedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError = null;

    const append = (target, chunk) => {
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (chunk.length > remaining) truncated = true;
      const portion = chunk.subarray(0, remaining);
      capturedBytes += portion.length;
      if (target === 'stdout') stdoutChunks.push(portion);
      else stderrChunks.push(portion);
    };

    try {
      if (shell) {
        // Join command and args into a single string, pass empty args array.
        // This avoids DEP0190 and allows .cmd scripts to run on Windows.
        const cmdString = [executable, ...(args || [])].join(' ');
        child = spawn(cmdString, [], {
          cwd,
          shell: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        child = spawn(executable, args || [], {
          cwd,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
      }
    } catch (error) {
      done({
        exitCode: null,
        error: error.message,
        stdout: '',
        stderr: '',
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
      return;
    }

    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => { spawnError = error.message; });

    let fallbackTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => { try { child.kill(); } catch {} });
        fallbackTimer = setTimeout(() => { try { child.kill(); } catch {} }, 2000);
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch { try { child.kill('SIGKILL'); } catch {} }
      }
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      done({
        exitCode: code,
        error: spawnError,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/**
 * Summarizes a file by returning its name, line count, size, and first line.
 *
 * @param {string} targetPath - The path to the file to summarize.
 * @returns {Promise<{fileName: string, lineCount: number, sizeBytes: number, firstLine: string}>}
 */
export async function summarize(targetPath) {
  const fileName = parse(targetPath).name;
  const stats = await stat(targetPath);
  const sizeBytes = stats.size;
  const content = await readFile(targetPath, 'utf8');
  const lines = content.split('\n');
  const lineCount = lines.length;
  const firstLine = lines[0] || '';
  return { fileName, lineCount, sizeBytes, firstLine };
}
