import { CraftError, CraftErrorCode } from '@craft-agent/contracts';
import type { ArtifactLifecycleState, ArtifactVersion } from '@craft-agent/contracts';
import type { CraftDatabase } from './database.js';

/**
 * SQLite metadata repository for artifact versions.
 *
 * Important separation:
 * - This repository stores metadata and version pointers.
 * - The actual bytes live in the content-addressed blob store.
 * - The SHA-256 hash is the bridge between metadata and blob bytes.
 */

/**
 * SHA-256 hex pattern.
 */
const HASH_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Allowed artifact lifecycle states for F2 Slice 1.
 *
 * This matches the contract type. Later slices may centralize this set.
 */
const ARTIFACT_STATES: ReadonlySet<ArtifactLifecycleState> = new Set([
  'created',
  'verified',
  'reviewed',
  'accepted',
  'rejected',
  'published',
  'archived',
]);

/**
 * Input to create an artifact metadata record.
 */
export interface CreateArtifactInput {
  readonly artifactId: string;
  readonly projectId?: string;
  readonly kind: string;
  readonly format: string;
  readonly createdAt?: string;
}

/**
 * Input to add a new immutable artifact version.
 */
export interface AddArtifactVersionInput {
  readonly artifactId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly state?: ArtifactLifecycleState;
  readonly storagePath?: string;
  readonly createdAt?: string;
}

/**
 * Raw SQLite artifact row.
 */
interface ArtifactRow {
  artifact_id: string;
  project_id: string | null;
  kind: string;
  format: string;
  latest_version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Raw SQLite artifact version row.
 */
interface ArtifactVersionRow {
  artifact_id: string;
  version: number;
  sha256: string;
  size_bytes: number;
  state: string;
  storage_path: string | null;
  created_at: string;
}

export class SqliteArtifactRepository {
  private readonly db: CraftDatabase;

  constructor(db: CraftDatabase) {
    this.db = db;
  }

  /**
   * Creates an artifact metadata record if it does not already exist.
   *
   * This operation is idempotent.
   */
  async createArtifact(input: CreateArtifactInput): Promise<void> {
    const artifactId = requireNonemptyString(input.artifactId, 'artifactId');
    const kind = requireNonemptyString(input.kind, 'kind');
    const format = requireNonemptyString(input.format, 'format');

    const createTransaction = this.db.transaction((): void => {
      const existing = this.db
        .prepare('SELECT artifact_id FROM artifacts WHERE artifact_id = ?')
        .get(artifactId) as { artifact_id: string } | undefined;

      if (existing) {
        return;
      }

      const now = input.createdAt ?? new Date().toISOString();

      this.db
        .prepare(
          `
            INSERT INTO artifacts (
              artifact_id,
              project_id,
              kind,
              format,
              latest_version,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, 0, ?, ?);
          `,
        )
        .run(
          artifactId,
          input.projectId ?? null,
          kind,
          format,
          now,
          now,
        );
    });

    createTransaction();
  }

  /**
   * Adds a new immutable artifact version.
   *
   * This increments latest_version atomically.
   */
  async addArtifactVersion(input: AddArtifactVersionInput): Promise<ArtifactVersion> {
    const artifactId = requireNonemptyString(input.artifactId, 'artifactId');
    const sha256 = normalizeHash(input.sha256);
    const sizeBytes = requireNonNegativeInteger(input.sizeBytes, 'sizeBytes');
    const state = requireValidState(input.state ?? 'created');

    const addVersionTransaction = this.db.transaction((): ArtifactVersion => {
      // Load the artifact metadata row.
      const artifact = this.db
        .prepare('SELECT * FROM artifacts WHERE artifact_id = ?')
        .get(artifactId) as ArtifactRow | undefined;

      if (!artifact) {
        throw new CraftError(
          CraftErrorCode.MALFORMED_ARTIFACT,
          `Cannot add version because artifact "${artifactId}" does not exist.`,
          { artifactId },
        );
      }

      // Versions start at 1 and increase by exactly 1.
      const nextVersion = artifact.latest_version + 1;
      const createdAt = input.createdAt ?? new Date().toISOString();
      const versionId = `${artifactId}:v${nextVersion}`;

      // Insert the immutable version row.
      this.db
        .prepare(
          `
            INSERT INTO artifact_versions (
              artifact_id,
              version,
              sha256,
              size_bytes,
              state,
              storage_path,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?);
          `,
        )
        .run(
          artifactId,
          nextVersion,
          sha256,
          sizeBytes,
          state,
          input.storagePath ?? null,
          createdAt,
        );

      // Update the artifact latest-version pointer.
      this.db
        .prepare(
          `
            UPDATE artifacts
            SET latest_version = ?,
                updated_at = ?
            WHERE artifact_id = ?;
          `,
        )
        .run(nextVersion, createdAt, artifactId);

      // Return the contract-shaped ArtifactVersion.
      return {
        id: versionId,
        artifactId,
        version: nextVersion,
        hash: sha256,
        sizeBytes,
        state,
        createdAt,
        storagePath: input.storagePath,
      };
    });

    return addVersionTransaction();
  }

  /**
   * Loads one artifact version.
   */
  async getArtifactVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactVersion> {
    requireNonemptyString(artifactId, 'artifactId');

    if (!Number.isInteger(version) || version < 1) {
      throw new CraftError(
        CraftErrorCode.MALFORMED_ARTIFACT,
        'Artifact version must be a positive integer.',
        { version },
      );
    }

    const row = this.db
      .prepare(
        `
          SELECT *
          FROM artifact_versions
          WHERE artifact_id = ? AND version = ?
        `,
      )
      .get(artifactId, version) as ArtifactVersionRow | undefined;

    if (!row) {
      throw new CraftError(
        CraftErrorCode.MALFORMED_ARTIFACT,
        `Artifact version not found: ${artifactId} v${version}.`,
        { artifactId, version },
      );
    }

    return rowToArtifactVersion(row);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a SQLite row into the contract ArtifactVersion shape.
 */
function rowToArtifactVersion(row: ArtifactVersionRow): ArtifactVersion {
  return {
    id: `${row.artifact_id}:v${row.version}`,
    artifactId: row.artifact_id,
    version: row.version,
    hash: row.sha256,
    sizeBytes: row.size_bytes,
    state: requireValidState(row.state),
    createdAt: row.created_at,
    storagePath: row.storage_path ?? undefined,
  };
}

/**
 * Normalizes and validates a SHA-256 hash.
 */
function normalizeHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CraftError(
      CraftErrorCode.MALFORMED_ARTIFACT,
      'Artifact hash must be a string.',
    );
  }

  const normalized = value.toLowerCase();

  if (!HASH_REGEX.test(normalized)) {
    throw new CraftError(
      CraftErrorCode.MALFORMED_ARTIFACT,
      'Artifact hash must be a 64-character SHA-256 hex string.',
      { hash: value },
    );
  }

  return normalized;
}

/**
 * Validates a non-negative integer.
 */
function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new CraftError(
      CraftErrorCode.MALFORMED_ARTIFACT,
      `${field} must be a non-negative integer.`,
      { field, value },
    );
  }

  return value;
}

/**
 * Validates artifact lifecycle state.
 */
function requireValidState(value: unknown): ArtifactLifecycleState {
  if (typeof value !== 'string' || !ARTIFACT_STATES.has(value as ArtifactLifecycleState)) {
    throw new CraftError(
      CraftErrorCode.MALFORMED_ARTIFACT,
      `Invalid artifact state "${String(value)}".`,
      { value },
    );
  }

  return value as ArtifactLifecycleState;
}

/**
 * Validates that a value is a nonempty string.
 */
function requireNonemptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CraftError(
      CraftErrorCode.MALFORMED_ARTIFACT,
      `${field} must be a nonempty string.`,
      { field },
    );
  }

  return value;
}
