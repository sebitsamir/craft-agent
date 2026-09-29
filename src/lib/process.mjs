import { spawn } from 'node:child_process';

/**
 * Runs a known executable without a shell. Captures bounded stdout/stderr and
 * terminates the process tree after the timeout. This is not a sandbox.
 */
export async function run(executable, args, cwd, options = {}) {
  const { timeoutMs = 120000, maxOutputBytes = 65536 } = options;
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
      child = spawn(executable, args, {
        cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      done({ exitCode: null, error: error.message, stdout: '', stderr: '', truncated, timedOut, durationMs: Date.now() - started });
      return;
    }
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => { spawnError = error.message; });
    let fallbackTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
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
        exitCode: code, error: spawnError,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        truncated, timedOut, durationMs: Date.now() - started,
      });
    });
  });
}
