/**
 * Stable, machine-readable error codes for the Junub Agent contract Layer.
 *
 * Thses codes are part of the public contract surface. Once phase 1 is accepted, renaming or removing codes should be treated as breaking change.
 */
export const JunubErrorCode = {
  // Schema & Versioning
  SCHEMA_VERSION_UNSUPPORTED: 'SCHEMA_VERSION_UNSUPPORTED',
  PROTOCOL_VERSION_UNSUPPORTED: 'PROTOCOL_VERSION_UNSUPPORTED',
  INVALID_SEMVER: 'INVALID_SEMVER',

  // Domain Identifiers
  MALFORMED_DOMAIN: 'MALFORMED_DOMAIN',

  // Task Contracts
  MALFORMED_TASK_CONTRACT: 'MALFORMED_TASK_CONTRACT',
  DUPLICATE_CRITERION_ID: 'DUPLICATE_CRITERION_ID',
  DUPLICATE_OUTPUT_ID: 'DUPLICATE_OUTPUT_ID',
  MISSING_REVIEWER_ROLE: 'MISSING_REVIEWER_ROLE',
  CRITERION_REMOVAL_DISALLOWED: 'CRITERION_REMOVAL_DISALLOWED',
  INVALID_TASK_VERSION: 'INVALID_TASK_VERSION',
  INVALID_BUDGET: 'INVALID_BUDGET',
  INVALID_DEADLINE: 'INVALID_DEADLINE',
  INVALID_POLICY_VERSION: 'INVALID_POLICY_VERSION',

  // Projects and workspaces.
  MALFORMED_PROJECT: 'MALFORMED_PROJECT',
  MALFORMED_WORKSPACE: 'MALFORMED_WORKSPACE',

  // Artifacts & Evidence
  MALFORMED_ARTIFACT: 'MALFORMED_ARTIFACT',
  MALFORMED_EVIDENCE: 'MALFORMED_EVIDENCE',
  ARTIFACT_VERSION_MISMATCH: 'ARTIFACT_VERSION_MISMATCH',
  EVIDENCE_UNBOUND_CRITERION: 'EVIDENCE_UNBOUND_CRITERION',
  EVIDENCE_UNBOUND_ARTIFACT: 'EVIDENCE_UNBOUND_ARTIFACT',
  EVIDENCE_HASH_MISMATCH: 'EVIDENCE_HASH_MISMATCH',

  // Capabilities
  CAPABILITY_NOT_FOUND: 'CAPABILITY_NOT_FOUND',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  CAPABILITY_PLANNED: 'CAPABILITY_PLANNED',
  CAPABILITY_RESTRICTED: 'CAPABILITY_RESTRICTED',
  INVALID_MANIFEST: 'INVALID_MANIFEST',

  // Protocol
  PROTOCOL_MALFORMED: 'PROTOCOL_MALFORMED',
  PROTOCOL_SEQUENCE_INVALID: 'PROTOCOL_SEQUENCE_INVALID',

    // ---------------------------------------------------------------------------
  // F2 kernel, storage, and durability errors.
  // These codes are stable operational codes used by the event store,
  // scheduler, budget guard, external-action guard, and artifact store.
  // ---------------------------------------------------------------------------

  // A stored or requested event envelope is malformed.
  EVENT_MALFORMED: 'EVENT_MALFORMED',

  // Event replay detected a missing, duplicated, or out-of-order sequence.
  EVENT_SEQUENCE_INVALID: 'EVENT_SEQUENCE_INVALID',

  // The task/step state machine received an illegal transition or payload.
  TASK_STATE_INVALID: 'TASK_STATE_INVALID',

  // A task exceeded an explicit budget limit.
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',

  // An external action was completed/failed in an unexpected state,
  // or a duplicate action was attempted without a proper idempotency key.
  EXTERNAL_ACTION_CONFLICT: 'EXTERNAL_ACTION_CONFLICT',

  // A content-addressed blob is missing from local artifact storage.
  ARTIFACT_BLOB_MISSING: 'ARTIFACT_BLOB_MISSING',

  // A stored blob no longer matches its expected SHA-256 hash.
  ARTIFACT_HASH_MISMATCH: 'ARTIFACT_HASH_MISMATCH',

  // SQLite schema migration failed and must not be partially applied.
  STORAGE_MIGRATION_FAILED: 'STORAGE_MIGRATION_FAILED',
} as const;

export type JunubErrorCode = (typeof JunubErrorCode)[keyof typeof JunubErrorCode];


// Serialized error shape used by protocol responses and structured logs.
export interface JunubErrorPayload {
  readonly code: JunubErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Typed error for contract, protocol, capability, and validation failures.
 *
 * Catch sites should switch on `code`, not message text.
 */
export class JunubError extends Error {
  readonly code: JunubErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: JunubErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'JunubError';
    this.code = code;
    this.details = details;

    // Preserves prototype chain when TypeScript targets older runtimes.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): JunubErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
