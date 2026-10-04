import { existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Film Project Mapper
 *
 * Maps a filesystem path to a film project structure.
 * Detects NLE project files, timelines (EDL/XML), scripts, and media assets.
 */

export interface FilmProjectInfo {
  readonly root: string;
  readonly projectType: 'premiere' | 'davinci' | 'finalcut' | 'generic' | 'unknown';
  readonly scripts: readonly string[];
  readonly timelines: readonly string[];
  readonly mediaAssets: readonly string[];
  readonly projectFiles: readonly string[];
  readonly isGitRepository: boolean;
  readonly isGitLfsPresent: boolean;
}

const SCRIPT_EXTS = new Set(['.fountain', '.fdx', '.txt', '.pdf']);
const TIMELINE_EXTS = new Set(['.edl', '.xml', '.fcpxml', '.aaf', '.otio']);
const MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.mxf', '.avi', '.mkv',
  '.wav', '.mp3', '.aac', '.aiff',
  '.png', '.jpg', '.jpeg', '.exr', '.dpx', '.tiff'
]);
const PROJECT_EXTS = new Set(['.prproj', '.drp', '.fcpbundle', '.aep']);
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.cache', 'previews', 'proxies']);

function runGitCommand(cwd: string, args: string[]): string | null {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000
    }).trim();
  } catch { return null; }
}

function discoverFiles(root: string): {
  scripts: string[], timelines: string[], media: string[], projects: string[]
} {
  const scripts: string[] = [];
  const timelines: string[] = [];
  const media: string[] = [];
  const projects: string[] = [];
  const pending: string[] = [root];

  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const fullPath = path.join(dir, entry);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        pending.push(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        const relPath = path.relative(root, fullPath).replaceAll('\\', '/');

        if (SCRIPT_EXTS.has(ext)) scripts.push(relPath);
        else if (TIMELINE_EXTS.has(ext)) timelines.push(relPath);
        else if (MEDIA_EXTS.has(ext)) media.push(relPath);
        else if (PROJECT_EXTS.has(ext)) projects.push(relPath);
      }
    }
  }

  return { scripts, timelines, media, projects };
}

export function mapFilmProject(startPath: string): FilmProjectInfo {
  const root = path.resolve(startPath);

  const isGit = runGitCommand(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  const isGitLfsPresent = isGit && existsSync(path.join(root, '.gitattributes')) &&
    (runGitCommand(root, ['lfs', 'ls-files']) !== null ||
     existsSync(path.join(root, '.lfsconfig')));

  const { scripts, timelines, media, projects } = discoverFiles(root);

  let projectType: FilmProjectInfo['projectType'] = 'unknown';
  if (projects.some(p => p.endsWith('.prproj'))) projectType = 'premiere';
  else if (projects.some(p => p.endsWith('.drp'))) projectType = 'davinci';
  else if (projects.some(p => p.endsWith('.fcpbundle'))) projectType = 'finalcut';
  else if (timelines.length > 0 || media.length > 0) projectType = 'generic';

  return {
    root,
    projectType,
    scripts,
    timelines,
    mediaAssets: media,
    projectFiles: projects,
    isGitRepository: isGit,
    isGitLfsPresent,
  };
}

/**
 * Returns true when the given path looks like a media asset (by extension).
 * Used by the film patch applicator to enforce media immutability.
 */
export function isMediaAssetPath(p: string): boolean {
  return MEDIA_EXTS.has(path.extname(p).toLowerCase());
}
