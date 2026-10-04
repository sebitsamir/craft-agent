import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateCapabilityManifest,
  type CapabilityPackManifest,
} from '@junub-agent/contracts';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(THIS_DIR, '..', 'manifest.json');

export function loadFilmPackManifest(): CapabilityPackManifest {
  let rawContent: string;
  try {
    rawContent = readFileSync(MANIFEST_PATH, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read film pack manifest at ${MANIFEST_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(
      `Film pack manifest is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return validateCapabilityManifest(parsed);
}

export function getManifestPath(): string {
  return MANIFEST_PATH;
}
