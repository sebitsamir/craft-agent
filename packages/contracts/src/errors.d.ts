/**
 * Stable, machine-readable error codes for the Junub Agent contract Layer.
 *
 * Thses codes are part of the public contract surface. Once phase 1 is accepted, renaming or removing codes should be treated as breaking change.
 */
export declare const JunubErrorCode: {
    readonly SCHEMA_VERSION_UNSUPPORTED: "SCHEMA_VERSION_UNSUPPORTED";
    readonly PROTOCOL_VERSION_UNSUPPORTED: "PROTOCOL_VERSION_UNSUPPORTED";
    readonly INVALID_SEMVER: "INVALID_SEMVER";
    readonly MALFORMED_DOMAIN: "MALFORMED_DOMAIN";
    readonly MALFORMED_TASK_CONTRACT: "MALFORMED_TASK_CONTRACT";
    readonly DUPLICATE_CRITERION_ID: "DUPLICATE_CRITERION_ID";
    readonly DUPLICATE_OUTPUT_ID: "DUPLICATE_OUTPUT_ID";
    readonly MISSING_REVIEWER_ROLE: "MISSING_REVIEWER_ROLE";
    readonly CRITERION_REMOVAL_DISALLOWED: "CRITERION_REMOVAL_DISALLOWED";
    readonly INVALID_TASK_VERSION: "INVALID_TASK_VERSION";
    readonly INVALID_BUDGET: "INVALID_BUDGET";
    readonly INVALID_DEADLINE: "INVALID_DEADLINE";
    readonly INVALID_POLICY_VERSION: "INVALID_POLICY_VERSION";
    readonly MALFORMED_PROJECT: "MALFORMED_PROJECT";
    readonly MALFORMED_WORKSPACE: "MALFORMED_WORKSPACE";
    readonly MALFORMED_ARTIFACT: "MALFORMED_ARTIFACT";
    readonly MALFORMED_EVIDENCE: "MALFORMED_EVIDENCE";
    readonly ARTIFACT_VERSION_MISMATCH: "ARTIFACT_VERSION_MISMATCH";
    readonly EVIDENCE_UNBOUND_CRITERION: "EVIDENCE_UNBOUND_CRITERION";
    readonly EVIDENCE_UNBOUND_ARTIFACT: "EVIDENCE_UNBOUND_ARTIFACT";
    readonly EVIDENCE_HASH_MISMATCH: "EVIDENCE_HASH_MISMATCH";
    readonly CAPABILITY_NOT_FOUND: "CAPABILITY_NOT_FOUND";
    readonly CAPABILITY_UNAVAILABLE: "CAPABILITY_UNAVAILABLE";
    readonly CAPABILITY_PLANNED: "CAPABILITY_PLANNED";
    readonly CAPABILITY_RESTRICTED: "CAPABILITY_RESTRICTED";
    readonly INVALID_MANIFEST: "INVALID_MANIFEST";
    readonly PROTOCOL_MALFORMED: "PROTOCOL_MALFORMED";
    readonly PROTOCOL_SEQUENCE_INVALID: "PROTOCOL_SEQUENCE_INVALID";
    readonly EVENT_MALFORMED: "EVENT_MALFORMED";
    readonly EVENT_SEQUENCE_INVALID: "EVENT_SEQUENCE_INVALID";
    readonly TASK_STATE_INVALID: "TASK_STATE_INVALID";
    readonly BUDGET_EXCEEDED: "BUDGET_EXCEEDED";
    readonly EXTERNAL_ACTION_CONFLICT: "EXTERNAL_ACTION_CONFLICT";
    readonly ARTIFACT_BLOB_MISSING: "ARTIFACT_BLOB_MISSING";
    readonly ARTIFACT_HASH_MISMATCH: "ARTIFACT_HASH_MISMATCH";
    readonly STORAGE_MIGRATION_FAILED: "STORAGE_MIGRATION_FAILED";
};
export type JunubErrorCode = (typeof JunubErrorCode)[keyof typeof JunubErrorCode];
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
export declare class JunubError extends Error {
    readonly code: JunubErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: JunubErrorCode, message: string, details?: Record<string, unknown>);
    toJSON(): JunubErrorPayload;
}
//# sourceMappingURL=errors.d.ts.map