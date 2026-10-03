import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Repository and Workspace Mapper
 *
 * Maps a filesystem path to a software repository structure.
 * Detects Git repositories, monorepo packages, and dirty worktrees.
 *
 * The Master Spec (Section 6) requires:
 * "Workspace: local or remote storage roots and grants.
 * A Git repository is an optional linked resource."
 *
 * And the S0 exit gate requires:
 * "Multi-package fixture and dirty worktree handled."
 *
 * This mapper provides the foundation for the inspector and verifier
 * to operate on real repositories without assuming a single-package layout.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Information about a single package within a repository.
 */
export interface PackageInfo {
  /** The package name from package.json. */
  readonly name: string;

  /** The relative path from the repository root to the package directory. */
  readonly relativePath: string;

  /** The absolute path to the package directory. */
  readonly absolutePath: string;

  /** Whether this package has its own package.json. */
  readonly hasPackageJson: boolean;
}

/**
 * Complete information about a mapped repository.
 */
export interface RepositoryInfo {
  /** The absolute path to the repository root. */
  readonly root: string;

  /** Whether this directory is inside a Git repository. */
  readonly isGitRepository: boolean;

  /** The current Git branch, if available. */
  readonly currentBranch?: string;

  /** Whether the Git worktree has uncommitted changes. */
  readonly isDirty: boolean;

  /** The list of packages found in the repository. */
  readonly packages: readonly PackageInfo[];

  /** Whether this is a monorepo (multiple packages). */
  readonly isMonorepo: boolean;

  /** The name from the root package.json, if present. */
  readonly rootPackageName?: string;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Runs a Git command and returns the trimmed stdout.
 * Returns null if the command fails (e.g., not a Git repository).
 */
function runGitCommand(cwd: string, args: string[]): string | null {
  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000, // 10 second timeout to prevent hanging.
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Checks if a directory is inside a Git repository.
 */
function isGitRepository(dir: string): boolean {
  return runGitCommand(dir, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/**
 * Gets the root of the Git repository containing the given directory.
 *
 * Note: Git on Windows often returns paths with forward slashes.
 * We wrap the result in path.resolve() to normalize it to OS-native
 * separators (backslashes on Windows) so it matches Node's path module output.
 */
function getGitRoot(dir: string): string | null {
  const root = runGitCommand(dir, ['rev-parse', '--show-toplevel']);
  return root ? path.resolve(root) : null;
}

/**
 * Gets the current Git branch name.
 */
function getCurrentBranch(dir: string): string | null {
  return runGitCommand(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

/**
 * Checks if the Git worktree has uncommitted changes.
 * Uses `git status --porcelain` which outputs nothing if clean.
 */
function isWorktreeDirty(dir: string): boolean {
  const status = runGitCommand(dir, ['status', '--porcelain']);
  return status !== null && status.length > 0;
}

// ---------------------------------------------------------------------------
// Package discovery
// ---------------------------------------------------------------------------

/**
 * Reads and parses a package.json file.
 * Returns null if the file doesn't exist or is invalid.
 */
function readPackageJson(packageJsonPath: string): { name?: string } | null {
  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Discovers all packages in a repository.
 *
 * Detection strategy:
 * 1. Check for a root package.json.
 * 2. Look for workspace patterns: packages/*, apps/*, packs/*.
 * 3. Recursively scan for package.json files (with depth limit).
 *
 * This handles both single-package and monorepo layouts.
 */
function discoverPackages(root: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const seen = new Set<string>();

  // Helper to add a package if it has a package.json.
  const addPackage = (dir: string, relativePath: string) => {
    const packageJsonPath = path.join(dir, 'package.json');
    if (!existsSync(packageJsonPath)) return;

    const packageJson = readPackageJson(packageJsonPath);
    if (!packageJson) return;

    // Avoid duplicates (can happen with symlinks or overlapping globs).
    if (seen.has(dir)) return;
    seen.add(dir);

    packages.push({
      name: packageJson.name ?? path.basename(dir),
      relativePath,
      absolutePath: dir,
      hasPackageJson: true,
    });
  };

  // 1. Check root package.json.
  addPackage(root, '.');

  // 2. Check common workspace directories.
  const workspaceDirs = ['packages', 'apps', 'packs'];
  for (const wsDir of workspaceDirs) {
    const wsPath = path.join(root, wsDir);
    if (!existsSync(wsPath) || !statSync(wsPath).isDirectory()) continue;

    // Scan immediate subdirectories.
    const entries = readdirSync(wsPath);
    for (const entry of entries) {
      const entryPath = path.join(wsPath, entry);
      if (statSync(entryPath).isDirectory()) {
        addPackage(entryPath, path.join(wsDir, entry));
      }
    }
  }

  // 3. Fallback: scan one level deep for any directory with package.json.
  // This catches non-standard layouts.
  const rootEntries = readdirSync(root);
  for (const entry of rootEntries) {
    // Skip common non-package directories.
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;

    const entryPath = path.join(root, entry);
    if (statSync(entryPath).isDirectory()) {
      addPackage(entryPath, entry);
    }
  }

  return packages;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Maps a filesystem path to a repository structure.
 *
 * This is the primary entry point for the repository mapper.
 * It resolves the Git root, detects packages, and reports dirty state.
 *
 * @param startPath The path to start mapping from (can be any subdirectory).
 * @returns Complete repository information.
 */
export function mapRepository(startPath: string): RepositoryInfo {
  const resolvedPath = path.resolve(startPath);

  // Check if this is a Git repository.
  const isGit = isGitRepository(resolvedPath);

  if (!isGit) {
    // Not a Git repository. Treat the startPath as the root.
    const packages = discoverPackages(resolvedPath);
    const rootPackageJson = readPackageJson(path.join(resolvedPath, 'package.json'));

    return {
      root: resolvedPath,
      isGitRepository: false,
      isDirty: false,
      packages,
      isMonorepo: packages.length > 1,
      rootPackageName: rootPackageJson?.name,
    };
  }

  // Get the Git root (the repository might be mapped from a subdirectory).
  const gitRoot = getGitRoot(resolvedPath) ?? resolvedPath;

  // Gather Git metadata.
  const currentBranch = getCurrentBranch(gitRoot) ?? undefined;
  const isDirty = isWorktreeDirty(gitRoot);

  // Discover packages.
  const packages = discoverPackages(gitRoot);
  const rootPackageJson = readPackageJson(path.join(gitRoot, 'package.json'));

  return {
    root: gitRoot,
    isGitRepository: true,
    currentBranch,
    isDirty,
    packages,
    isMonorepo: packages.length > 1,
    rootPackageName: rootPackageJson?.name,
  };
}

/**
 * Gets the relative path from the repository root to a given file.
 * Useful for generating portable artifact references.
 */
export function getRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath);
}
