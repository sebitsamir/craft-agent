import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { run } from './process.mjs';

const EXCLUDED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.venv']);
const SOURCE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rs', '.go', '.java', '.cpp', '.cc', '.c', '.h']);
const TEST_RE = /(^|\/)(__tests__\/|tests?\/|[^/]+\.(test|spec)\.)/i;
const MAX_FILES = 10000;

async function inventory(root) {
  const files = [];
  const warnings = [];
  const pending = [root];
  let limited = false;
  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      warnings.push(`Could not read ${relative(root, dir) || '.'}: ${error.code || error.message}`);
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
      // Symlinks are deliberately not traversed, including symlinked directories.
      if (files.length >= MAX_FILES) { limited = true; break; }
    }
    if (limited) break;
  }
  return { files: files.sort(), limited, warnings };
}

async function manifestAt(root) {
  let source;
  try { source = await readFile(join(root, 'package.json'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read package.json: ${error.message}`);
  }
  let manifest;
  try { manifest = JSON.parse(source); }
  catch (error) { throw new Error(`Invalid package.json: ${error.message}`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid package.json: expected an object');
  if (manifest.scripts !== undefined && (typeof manifest.scripts !== 'object' || !manifest.scripts || Array.isArray(manifest.scripts))) {
    throw new Error('Invalid package.json: scripts must be an object');
  }
  return manifest;
}

function gitPaths(output) {
  const entries = output.split('\0');
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (/R|C/.test(status)) {
      const original = entries[++i];
      if (original) paths.push(original);
    }
  }
  return paths;
}

export async function inspect(input = '.') {
  const root = resolve(input);
  if (!(await stat(root)).isDirectory()) throw new Error('Target must be a directory');
  const { files, limited, warnings } = await inventory(root);
  const manifest = await manifestAt(root);
  const counts = {};
  for (const file of files) {
    const ext = file.match(/\.[^./]+$/)?.[0] ?? '(none)';
    counts[ext] = (counts[ext] ?? 0) + 1;
  }
  const git = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], root, { timeoutMs: 10000, maxOutputBytes: 1048576 });
  const isGit = git.exitCode === 0 && !git.timedOut && !git.error;
  const scripts = manifest?.scripts ?? {};
  const observations = [...warnings];
  if (!isGit) observations.push(`Git status unavailable: ${git.error || git.stderr.trim() || (git.timedOut ? 'timed out' : 'not a Git worktree')}`);
  if (git.truncated) observations.push('Git status output was truncated; changed paths are incomplete.');
  if (manifest && !files.some((f) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|bun\.lock)$/.test(f))) {
    observations.push('A JavaScript package was found without a recognized lockfile in the scanned files.');
  }
  if (manifest && !Object.hasOwn(scripts, 'test')) observations.push('The root package does not declare a test script.');
  if (limited) observations.push(`The file inventory stopped at ${MAX_FILES} files.`);
  return {
    schemaVersion: 1,
    root,
    generatedAt: new Date().toISOString(),
    inventory: {
      total: files.length, limited, source: files.filter((f) => SOURCE.has(f.match(/\.[^./]+$/)?.[0])),
      tests: files.filter((f) => TEST_RE.test(f)), extensions: counts,
    },
    package: manifest ? { name: manifest.name ?? null, scripts } : null,
    git: { available: isGit, dirty: isGit ? git.stdout.length > 0 : null, changedPaths: isGit ? gitPaths(git.stdout) : [], partial: git.truncated },
    observations,
  };
}
