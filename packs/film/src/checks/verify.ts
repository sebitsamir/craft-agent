import path from 'node:path';
import { inspectFilmProject } from './inspect.js';

/**
 * The result of checking a single media reference in a timeline.
 */
export interface MediaLinkCheck {
  readonly timelinePath: string;
  readonly clipName: string;
  readonly status: 'linked' | 'missing';
}

/**
 * Full verification report for media links.
 */
export interface FilmVerificationReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly passed: boolean;
  readonly checks: readonly MediaLinkCheck[];
}

/**
 * Verifies that all media assets referenced in timelines actually exist
 * in the project's media directories.
 *
 * This is the film equivalent of "npm run test" — it catches the dreaded
 * "Media Offline" state before it reaches the editor.
 *
 * @param root  The root directory of the film project.
 * @returns     A verification report with 'linked' or 'missing' status for each clip.
 */
export async function verifyMediaLinks(root: string): Promise<FilmVerificationReport> {
  const inspection = await inspectFilmProject(root);
  const checks: MediaLinkCheck[] = [];
  let allPassed = true;

  // Build a normalized set of known media filenames for fast lookup.
  // We use lowercase basenames to handle cross-platform case insensitivity
  // and relative path variations in EDLs.
  const knownMedia = new Set(
    inspection.project.mediaAssets.map((p) => path.basename(p).toLowerCase()),
  );

  for (const timeline of inspection.timelines) {
    for (const clipName of timeline.referencedClips) {
      const normalizedClip = path.basename(clipName).toLowerCase();
      const exists = knownMedia.has(normalizedClip);

      const status: 'linked' | 'missing' = exists ? 'linked' : 'missing';
      if (status === 'missing') {
        allPassed = false;
      }

      checks.push({
        timelinePath: timeline.path,
        clipName,
        status,
      });
    }
  }

  return {
    schemaVersion: 1,
    root: inspection.root,
    passed: allPassed,
    checks,
  };
}
