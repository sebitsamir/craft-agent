/**
 * Lifecycle state for an artifact version.
 *
 * These states are deliberately conservative. “published” is not the same as
 * “verified”, and “verified” is not the same as “accepted”.
 */
export type ArtifactLifecycleState =
  | 'created'
  | 'verified'
  | 'reviewed'
  | 'accepted'
  | 'rejected'
  | 'published'
  | 'archived';

/**
 * High-level origin classification for an artifact.
 */
export type ArtifactSourceType =
  | 'user'
  | 'generated'
  | 'derived'
  | 'external'
  | 'mixed';

/**
 * Rights metadata attached to an artifact.
 *
 * This is descriptive metadata, not legal advice. Future phases may add
 * jurisdiction-aware controls and provenance standards such as C2PA.
 */
export interface ArtifactRights {
  readonly license?: string;
  readonly owner?: string;
  readonly sources?: readonly string[];
  readonly consent?: boolean;
  readonly notes?: string;
}

/**
 * Provenance metadata describing how an artifact came into existence.
 */
export interface ArtifactProvenance {
  readonly sourceType?: ArtifactSourceType;
  readonly generator?: string;
  readonly model?: string;
  readonly tool?: string;
  readonly sourceUri?: string;
  readonly retrievedAt?: string;
  readonly c2pa?: boolean;
  readonly notes?: string;
}

/**
 * One directed transformation edge in artifact lineage.
 *
 * Lineage should answer:
 * - Which inputs were used?
 * - Which tool/model/parameters produced the output?
 * - Which permissions authorized the operation?
 * - Which output hash resulted?
 */
export interface ArtifactLineageEdge {
  readonly id?: string;
  readonly inputHashes: readonly string[];
  readonly outputHash: string;
  readonly tool?: string;
  readonly model?: string;
  readonly parameters?: Record<string, unknown>;
  readonly permissions?: readonly string[];
  readonly reviewedBy?: string;
  readonly at?: string;
}

/**
 * A logical artifact with a stable id and a pointer to its latest version.
 */
export interface Artifact {
  readonly id: string;
  readonly projectId?: string;
  readonly kind: string;
  readonly format: string;
  readonly mimeType?: string;
  readonly latestVersion: number;
  readonly editableSourceReference?: string;
  readonly rights?: ArtifactRights;
  readonly provenance?: ArtifactProvenance;
  readonly lineage?: readonly ArtifactLineageEdge[];
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/**
 * An immutable artifact version.
 *
 * The content hash is authoritative for evidence binding. Evidence that does
 * not match the exact version hash is invalid.
 */
export interface ArtifactVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly hash: string;
  readonly sizeBytes: number;
  readonly state: ArtifactLifecycleState;
  readonly createdAt: string;

  readonly format?: string;
  readonly mimeType?: string;
  readonly storagePath?: string;
  readonly sourceReference?: string;
  readonly metadata?: Record<string, unknown>;
}
