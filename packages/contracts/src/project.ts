/**
 * Project budget fields mirror task budget fields but live at project level.
 */
export interface ProjectBudget {
  readonly maxModelCalls?: number;
  readonly maxComputeMinutes?: number;
  readonly maxCost?: number;
  readonly maxStorageBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxRetryAttempts?: number;
}

/**
 * A collaborator attached to a project.
 *
 * In later phases, role identity and approval authority become policy-checked.
 * A string role is not identity verification.
 */
export interface ProjectCollaborator {
  readonly id: string;
  readonly role: string;
  readonly name?: string;
  readonly permissions?: readonly string[];
}

/**
 * Project policy metadata.
 */
export interface ProjectPolicy {
  readonly id?: string;
  readonly version?: string;
  readonly name?: string;
  readonly rules?: readonly string[];
}

/**
 * A resource linked to a project.
 *
 * A Git repository is one example of a project resource, not the only one.
 */
export interface ProjectResource {
  readonly id: string;
  readonly kind: string;
  readonly uri: string;
  readonly description?: string;
  readonly readOnly?: boolean;
}

/**
 * Link between a project and an artifact.
 */
export interface ProjectArtifactLink {
  readonly artifactId: string;
  readonly role?: string;
  readonly addedAt?: string;
}

/**
 * A lightweight history entry for project-level events.
 *
 * The durable kernel will later store authoritative event history separately.
 */
export interface ProjectHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: string;
  readonly description: string;
  readonly actor?: string;
}

/**
 * A Junub Agent project.
 *
 * A project owns purpose, collaborators, policy, budget, resources, artifact
 * links, and history. It is not tied to a Git repository by definition.
 */
export interface Project {
  readonly schemaVersion: 1;

  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly purpose: string;

  readonly workspaceId?: string;

  readonly collaborators?: readonly ProjectCollaborator[];
  readonly policy?: ProjectPolicy;
  readonly budget?: ProjectBudget;
  readonly resources?: readonly ProjectResource[];

  readonly artifactLinks?: readonly ProjectArtifactLink[];
  readonly history?: readonly ProjectHistoryEntry[];

  readonly createdAt?: string;
  readonly updatedAt?: string;

  readonly metadata?: Record<string, unknown>;
}
