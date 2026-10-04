import { spawn } from 'node:child_process';

/**
 * Result of a bounded child-process execution.
 *
 * This matches the shape returned by the v0.3 seed's process.mjs so that
 * inspect and verify produce byte-identical output after the extraction.
 */
export interface RunResult {
  /** Process exit code. 1 when the process could not be spawned. */
  readonly exitCode: number;

  /** Captured standard output, truncated to maxOutputBytes. */
  readonly stdout: string;

  /** Captured standard error, truncated to maxOutputBytes. */
  readonly stderr: string;

  /** True when the process was killed because it exceeded timeoutMs. */
  readonly timedOut: boolean;

  /** Spawn-level error message, or null when the process ran normally. */
  readonly error: string | null;

  /** True when stdout or stderr was truncated to stay within bounds. */
  readonly truncated: boolean;
}

/**
 * Options for a bounded child-process execution.
 */
export interface RunOptions {
  /** Maximum wall-clock time before the process is killed. Default 30 000 ms. */
  readonly timeoutMs?: number;

  /** Maximum bytes captured per stream before truncation. Default 1 MiB. */
  readonly maxOutputBytes?: number;
}

/**
 * Runs a command with bounded time and output.
 *
 * This is a faithful TypeScript port of the v0.3 seed's process.mjs.
 * It uses spawn (not execFile) so that output can be truncated gracefully
 * instead of killing the process when maxBuffer is exceeded.
 *
 * @param executable  The program to run (e.g. "git", "npm", "cmd.exe").
 * @param args        Argument list.
 * @param cwd         Working directory.
 * @param options     Timeout and output bounds.
 */
export async function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576; // 1 MiB

  return new Promise<RunResult>((resolve) => {
    // Accumulate output as Buffer chunks so we can slice precisely.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;

    // Spawn the child process. stdin is ignored; stdout/stderr are piped.
    const child = spawn(executable, args as string[], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Kill the process if it exceeds the wall-clock budget.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    // Collect stdout up to the byte bound.
    // We use 'any' for the chunk parameter to satisfy @types/node stream
    // signatures, then cast to Buffer since stdio is piped (not utf8).
    child.stdout?.on('data', (chunk: any) => {
      const buf = chunk as Buffer;
      if (stdoutBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutBytes;
        const slice = buf.subarray(0, remaining);
        stdoutChunks.push(slice);
        stdoutBytes += slice.length;
        if (slice.length < buf.length) truncated = true;
      } else {
        truncated = true;
      }
    });

    // Collect stderr up to the byte bound.
    child.stderr?.on('data', (chunk: any) => {
      const buf = chunk as Buffer;
      if (stderrBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stderrBytes;
        const slice = buf.subarray(0, remaining);
        stderrChunks.push(slice);
        stderrBytes += slice.length;
        if (slice.length < buf.length) truncated = true;
      } else {
        truncated = true;
      }
    });

    // Handle spawn-level errors (e.g. executable not found).
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut: false,
        error: err.message,
        truncated,
      });
    });

    // Handle normal process exit.
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        error: null,
        truncated,
      });
    });
  });
}
