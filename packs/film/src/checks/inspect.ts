import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { mapFilmProject, type FilmProjectInfo } from '../project.js';

export interface TimelineInfo {
  readonly path: string;
  readonly format: 'edl' | 'xml' | 'unknown';
  readonly referencedClips: readonly string[];
}

export interface VerifiedClip {
  readonly clipName: string;
  readonly mediaPath: string;
  readonly mediaExists: boolean;
  readonly source: 'timeline' | 'raw_media';
}

export interface FilmInspectionReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly project: FilmProjectInfo;
  readonly timelines: readonly TimelineInfo[];
  readonly clips: readonly VerifiedClip[];
}

async function findMediaFiles(dir: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip heavy/irrelevant directories
      if (['node_modules', '.next', '.git', '.junub', 'dist', '.vscode'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findMediaFiles(fullPath, extensions));
      } else if (entry.isFile()) {
        if (extensions.includes(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    }
  } catch {}
  return files;
}

export async function inspectFilmProject(root: string): Promise<FilmInspectionReport> {
  const project = mapFilmProject(root);
  const timelines: TimelineInfo[] = [];
  const clipsMap = new Map<string, VerifiedClip>();

  // 1. Parse Timelines (EDL/XML)
  for (const timelinePath of project.timelines) {
    const ext = path.extname(timelinePath).toLowerCase();
    let format: 'edl' | 'xml' | 'unknown' = 'unknown';
    const referencedClips: string[] = [];

    if (ext === '.edl') {
      format = 'edl';
      try {
        const content = await readFile(path.join(root, timelinePath), 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^\*\s*FROM CLIP NAME:\s*(.+)$/i);
          if (match && match[1]) {
            const clipName = match[1].trim();
            referencedClips.push(clipName);
            const mediaPath = path.isAbsolute(clipName) ? clipName : path.join(root, clipName);
            let exists = false;
            try { await stat(mediaPath); exists = true; } catch {}
            clipsMap.set(mediaPath, { clipName, mediaPath, mediaExists: exists, source: 'timeline' });
          }
        }
      } catch {}
    } else if (ext === '.xml' || ext === '.fcpxml') {
      format = 'xml';
    }
    timelines.push({ path: timelinePath, format, referencedClips });
  }

  // 2. Recursive Raw Media Fallback (Media Asset Management)
  const videoExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.mxf', '.wav', '.mp3'];
  const rawMediaFiles = await findMediaFiles(root, videoExtensions);

  for (const filePath of rawMediaFiles) {
    if (!clipsMap.has(filePath)) {
      clipsMap.set(filePath, {
        clipName: path.basename(filePath),
        mediaPath: filePath,
        mediaExists: true,
        source: 'raw_media'
      });
    }
  }

  return {
    schemaVersion: 1,
    root: project.root,
    project,
    timelines,
    clips: Array.from(clipsMap.values()),
  };
}
