import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateCapabilityManifest,
  type CapabilityPackManifest,
} from '@craft-agent/contracts';

/**
 * Software Pack Manifest Loader
 *
 * Loads and validates the software pack manifest from disk.
 * The manifest is the formal declaration of what this pack can do,
 * what permissions it needs, and what validators it provides.
 *
 * The Master Spec (Section 8) requires:
 * "A pack manifest declares: id/semver, supported task intents,
 * input/output artifact schemas, required tools and permissions..."
 */

/**
 * The directory containing this module (packs/software/src/).
 */
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Path to the manifest.json file (packs/software/manifest.json).
 */
const MANIFEST_PATH = path.resolve(THIS_DIR, '..', 'manifest.json');

/**
 * Loads the software pack manifest from disk and validates it.
 *
 * @returns The validated CapabilityPackManifest.
 * @throws CraftError if the manifest is missing or invalid.
 */
export function loadSoftwarePackManifest(): CapabilityPackManifest {
  // Read the manifest file.
  let rawContent: string;
  try {
    rawContent = readFileSync(MANIFEST_PATH, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read software pack manifest at ${MANIFEST_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Parse the JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(
      `Software pack manifest is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Validate against the CapabilityPackManifest schema.
  // This throws CraftError with a stable code if invalid.
  return validateCapabilityManifest(parsed);
}

/**
 * Returns the manifest path (useful for diagnostics).
 */
export function getManifestPath(): string {
  return MANIFEST_PATH;
}
