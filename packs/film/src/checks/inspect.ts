import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mapFilmProject, type FilmProjectInfo } from '../project.js';

/**
 * Parsed information about a single timeline file.
 */
export interface TimelineInfo {
  readonly path: string;
  readonly format: 'edl' | 'xml' | 'unknown';
  readonly referencedClips: readonly string[];
}

/**
 * Full inspection report for a film project.
 */
export interface FilmInspectionReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly project: FilmProjectInfo;
  readonly timelines: readonly TimelineInfo[];
}

/**
 * Inspects a film project, mapping assets and parsing timeline references.
 *
 * @param root  The root directory of the film project.
 * @returns     A structured report of project assets and timeline dependencies.
 */
export async function inspectFilmProject(root: string): Promise<FilmInspectionReport> {
  const project = mapFilmProject(root);
  const timelines: TimelineInfo[] = [];

  for (const timelinePath of project.timelines) {
    const ext = path.extname(timelinePath).toLowerCase();
    let format: 'edl' | 'xml' | 'unknown' = 'unknown';
    const referencedClips: string[] = [];

    if (ext === '.edl') {
      format = 'edl';
      try {
        const content = await readFile(path.join(root, timelinePath), 'utf8');
        // Simple EDL parser: look for "* FROM CLIP NAME:  <filename>"
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^\*\s*FROM CLIP NAME:\s*(.+)$/i);
          if (match && match[1]) {
            referencedClips.push(match[1].trim());
          }
        }
      } catch {
        // Ignore read errors for individual timelines; report what we can.
      }
    } else if (ext === '.xml' || ext === '.fcpxml') {
      format = 'xml';
      // XML parsing without external deps is complex; stubbed for T0 Slice 2.
      // A future slice could add a naive regex or a dedicated XML stream parser.
    }

    timelines.push({ path: timelinePath, format, referencedClips });
  }

  return {
    schemaVersion: 1,
    root: project.root,
    project,
    timelines,
  };
}
