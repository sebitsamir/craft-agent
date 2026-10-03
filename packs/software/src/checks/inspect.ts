import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { run } from '../process.js';

/**
 * Software Repository Inspector
 *
 * Faithful TypeScript port of the v0.3 seed's inspect.mjs.
 * The output shape is identical so that CLI parity tests pass unchanged.
 *
 * Output contract:
 *   schemaVersion: 1
 *   root: absolute path
 *   generatedAt: ISO timestamp
 *   inventory: { total, limited, source: string[], tests: string[], extensions }
 *   package: { name, scripts } | null
 *   git: { available, dirty, changedPaths, partial }
 *   observations: string[]
 */

// ---------------------------------------------------------------------------
// Constants (identical to the seed)
// ---------------------------------------------------------------------------

/** Directories never traversed during inventory. */
const EXCLUDED = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build',
  'coverage', '.turbo', '.venv',
]);

/** File extensions counted as source code. */
const SOURCE = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.rs', '.go', '.java', '.cpp', '.cc', '.c', '.h',
]);

/**
 * Matches test files:
 * - Files inside a test/ or tests/ directory.
 * - Files with .test. or .spec. before the extension.
 */
const TEST_RE = /(^|\/)(tests\/|tests?\/|[^/]+\.(test|spec)\.)/i;

/** Safety cap so a huge repository cannot exhaust memory. */
const MAX_FILES = 10_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively inventories files under a root directory.
 * Returns sorted relative paths (forward-slash normalised), a truncation
 * flag, and human-readable warnings for unreadable directories.
 */
async function inventory(root: string): Promise<{
  files: string[];
  limited: boolean;
  warnings: string[];
}> {
  const files: string[] = [];
  const warnings: string[] = [];
  const pending: string[] = [root];
  let limited = false;

  while (pending.length) {
    const dir = pending.pop()!;
    let entries;

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
      warnings.push(`Could not read ${relative(root, dir) || '.'}: ${code}`);
      continue;
    }

    // Deterministic ordering.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile()) {
        // Normalise to forward slashes for cross-platform consistency.
        files.push(relative(root, fullPath).replaceAll('\\', '/'));
      }
      // Symlinks are deliberately not traversed.

      if (files.length >= MAX_FILES) {
        limited = true;
        break;
      }
    }

    if (limited) break;
  }

  return { files: files.sort(), limited, warnings };
}

/**
 * Reads and validates the root package.json.
 * Returns null when the file does not exist.
 */
async function manifestAt(root: string): Promise<Record<string, unknown> | null> {
  let source: string;

  try {
    source = await readFile(join(root, 'package.json'), 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read package.json: ${(error as Error).message}`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch (error: unknown) {
    throw new Error(`Invalid package.json: ${(error as Error).message}`);
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Invalid package.json: expected an object');
  }

  const obj = manifest as Record<string, unknown>;

  if (
    obj.scripts !== undefined &&
    (typeof obj.scripts !== 'object' || obj.scripts === null || Array.isArray(obj.scripts))
  ) {
    throw new Error('Invalid package.json: scripts must be an object');
  }

  return obj;
}

/**
 * Parses `git status --porcelain=v1 -z` output into a list of changed paths.
 *
 * The -z flag separates entries with NUL (\0). Rename/copy entries (status
 * contains R or C) are followed by the original path, which is also captured.
 */
function gitPaths(output: string): string[] {
  const entries = output.split('\0');
  const paths: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));

    // Rename/copy entries carry a second path (the original).
    if (/R|C/.test(status)) {
      const original = entries[++i];
      if (original) paths.push(original);
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspects a software repository and produces a structured report.
 *
 * @param input  Directory to inspect. Defaults to the current directory.
 * @returns      A report whose shape is identical to the v0.3 seed output.
 */
export async function inspect(input: string = '.'): Promise<Record<string, unknown>> {
  const root = resolve(input);

  if (!(await stat(root)).isDirectory()) {
    throw new Error('Target must be a directory');
  }

  // 1. File inventory.
  const { files, limited, warnings } = await inventory(root);

  // 2. Root package.json.
  const manifest = await manifestAt(root);

  // 3. Extension histogram.
  const counts: Record<string, number> = {};
  for (const file of files) {
    const ext = file.match(/\.[^./]+$/)?.[0] ?? '(none)';
    counts[ext] = (counts[ext] ?? 0) + 1;
  }

  // 4. Git status (bounded, 10 s timeout, 1 MiB output cap).
  const git = await run(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'],
    root,
    { timeoutMs: 10_000, maxOutputBytes: 1_048_576 },
  );

  const isGit = git.exitCode === 0 && !git.timedOut && !git.error;

  // 5. Observations (human-readable diagnostics).
  const scripts = (manifest?.scripts ?? {}) as Record<string, string>;
  const observations: string[] = [...warnings];

  if (!isGit) {
    observations.push(
      `Git status unavailable: ${
        git.error || git.stderr.trim() || (git.timedOut ? 'timed out' : 'not a Git worktree')
      }`,
    );
  }

  if (git.truncated) {
    observations.push('Git status output was truncated; changed paths are incomplete.');
  }

  if (
    manifest &&
    !files.some((f) =>
      /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|bun\.lock)$/.test(f),
    )
  ) {
    observations.push(
      'A JavaScript package was found without a recognized lockfile in the scanned files.',
    );
  }

  if (manifest && !Object.hasOwn(scripts, 'test')) {
    observations.push('The root package does not declare a test script.');
  }

  if (limited) {
    observations.push(`The file inventory stopped at ${MAX_FILES} files.`);
  }

  // 6. Assemble the report (field order matches the seed).
  return {
    schemaVersion: 1,
    root,
    generatedAt: new Date().toISOString(),
    inventory: {
      total: files.length,
      limited,
      source: files.filter((f) => SOURCE.has(f.match(/\.[^./]+$/)?.[0] ?? '')),
      tests: files.filter((f) => TEST_RE.test(f)),
      extensions: counts,
    },
    package: manifest
      ? { name: (manifest.name as string) ?? null, scripts }
      : null,
    git: {
      available: isGit,
      dirty: isGit ? git.stdout.length > 0 : null,
      changedPaths: isGit ? gitPaths(git.stdout) : [],
      partial: git.truncated,
    },
    observations,
  };
}
