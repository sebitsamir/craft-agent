/**
 * Stable, machine-readable error codes for the Craft Agent contract Layer.
 *
 * Thses codes are part of the public contract surface. Once phase 1 is accepted, renaming or removing codes should be treated as breaking change.
 */
export const CraftErrorCode = {
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
} as const;

export type CraftErrorCode = (typeof CraftErrorCode)[keyof typeof CraftErrorCode];


// Serialized error shape used by protocol responses and structured logs.
export interface CraftErrorPayload {
  readonly code: CraftErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Typed error for contract, protocol, capability, and validation failures.
 *
 * Catch sites should switch on `code`, not message text.
 */
export class CraftError extends Error {
  readonly code: CraftErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CraftErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = 'CraftError';
    this.code = code;
    this.details = details;

    // Preserves prototype chain when TypeScript targets older runtimes.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): CraftErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
