/**
 * Patch Model
 *
 * A patch is a structured, validated description of intended file edits.
 * It is the unit of change that Phase S3 applies to a repository — always
 * under the S2 worktree safety gate.
 *
 * The Master Spec (Section 13) requires:
 * "Patches apply to a bounded file set only; out-of-scope paths rejected."
 *
 * The core safety mechanism is the allowedPaths scope. Every operation must
 * target a path that is explicitly listed in allowedPaths. Anything else is
 * rejected at validation time, before the patch can reach the filesystem.
 *
 * Path safety:
 * - Absolute paths are rejected (a patch cannot write outside the repository).
 * - Path traversal ("..") is rejected (a patch cannot escape the root).
 * - Paths are normalized to forward slashes for consistent comparison.
 */

/**
 * The kind of file operation a patch step performs.
 */
export type PatchOperationKind = 'create' | 'update' | 'delete';

/**
 * A single file operation within a patch.
 */
export interface PatchOperation {
  /** What to do with the target file. */
  readonly kind: PatchOperationKind;

  /** Repository-relative path of the target file. */
  readonly path: string;

  /**
   * File content. Required for create/update; must be absent for delete.
   */
  readonly content?: string;
}

/**
 * A bounded, validated set of file edits.
 */
export interface Patch {
  readonly schemaVersion: 1;

  /** Stable identifier for this patch. */
  readonly patchId: string;

  /** Human-readable summary of what the patch does. */
  readonly description: string;

  /**
   * The bounded file set this patch is allowed to touch. Any operation
   * targeting a path not in this list is rejected.
   */
  readonly allowedPaths: readonly string[];

  /** The ordered file operations to apply. */
  readonly operations: readonly PatchOperation[];
}

/**
 * The result of validating a patch.
 */
export interface PatchValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const PATCH_OPERATION_KINDS = new Set<string>(['create', 'update', 'delete']);

/**
 * Validates an unknown value against the Patch schema.
 *
 * Returns a structured result listing every problem found, so callers can
 * report all issues at once rather than failing on the first one.
 *
 * @param input  The value to validate (typically parsed JSON).
 * @returns      A validation result with `valid` and a list of `errors`.
 */
export function validatePatch(input: unknown): PatchValidationResult {
  const errors: string[] = [];

  // The patch must be a plain object.
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Patch must be an object.'] };
  }

  const patch = input as Record<string, unknown>;

  // schemaVersion must be exactly 1.
  if (patch.schemaVersion !== 1) {
    errors.push(
      `Unsupported patch schemaVersion: ${String(patch.schemaVersion)}. Expected 1.`,
    );
  }

  // patchId must be a non-empty string.
  if (typeof patch.patchId !== 'string' || patch.patchId.trim().length === 0) {
    errors.push('patch.patchId must be a non-empty string.');
  }

  // description must be a string.
  if (typeof patch.description !== 'string') {
    errors.push('patch.description must be a string.');
  }

  // Build the normalized allowed-path set first so operations can be
  // scope-checked against it.
  let allowedSet: Set<string> | undefined;
  const allowedPaths = patch.allowedPaths;
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    errors.push('patch.allowedPaths must be a non-empty array of file paths.');
  } else {
    allowedSet = new Set<string>();
    for (let i = 0; i < allowedPaths.length; i++) {
      const p = allowedPaths[i];
      if (typeof p !== 'string' || p.trim().length === 0) {
        errors.push(`patch.allowedPaths[${i}] must be a non-empty string.`);
        continue;
      }
      const problem = checkPathSafety(p);
      if (problem) {
        errors.push(`patch.allowedPaths[${i}]: ${problem}`);
      } else {
        allowedSet.add(normalizePath(p));
      }
    }
  }

  // Validate each operation.
  const operations = patch.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    errors.push('patch.operations must be a non-empty array.');
  } else {
    for (let i = 0; i < operations.length; i++) {
      errors.push(...validateOperation(operations[i], i, allowedSet));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates a single patch operation.
 *
 * @param op          The operation value.
 * @param index       Its index, used in error labels.
 * @param allowedSet  The normalized allowed-path set for scope checking.
 * @returns           A list of error messages (empty when valid).
 */
function validateOperation(
  op: unknown,
  index: number,
  allowedSet: Set<string> | undefined,
): string[] {
  const errors: string[] = [];
  const label = `patch.operations[${index}]`;

  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return [`${label} must be an object.`];
  }

  const operation = op as Record<string, unknown>;

  // kind must be a known operation kind.
  if (!PATCH_OPERATION_KINDS.has(operation.kind as string)) {
    errors.push(`${label}.kind must be one of: create, update, delete.`);
    return errors;
  }
  const kind = operation.kind as PatchOperationKind;

  // path must be a non-empty, safe string.
  if (typeof operation.path !== 'string' || operation.path.trim().length === 0) {
    errors.push(`${label}.path must be a non-empty string.`);
    return errors;
  }

  const pathProblem = checkPathSafety(operation.path);
  if (pathProblem) {
    errors.push(`${label}.path: ${pathProblem}`);
    return errors;
  }

  // content rules depend on the operation kind.
  if (kind === 'delete') {
    if (operation.content !== undefined) {
      errors.push(`${label}.content must be absent for a delete operation.`);
    }
  } else if (typeof operation.content !== 'string') {
    errors.push(`${label}.content must be a string for ${kind} operations.`);
  }

  // Scope check: the operation path must be within allowedPaths.
  if (allowedSet && !allowedSet.has(normalizePath(operation.path))) {
    errors.push(
      `${label}.path "${operation.path}" is outside the declared allowedPaths scope.`,
    );
  }

  return errors;
}

/**
 * Normalizes a path to forward slashes and strips a leading "./".
 */

export function normalizePath(p: string): string {
  return p.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Checks a path for safety violations.
 *
 * @param p  The path to check.
 * @returns  An error message when unsafe, or null when safe.
 */
function checkPathSafety(p: string): string | null {
  const normalized = p.replaceAll('\\', '/');

  // Reject Unix-style absolute paths.
  if (normalized.startsWith('/')) {
    return 'absolute paths are not allowed';
  }

  // Reject Windows-style absolute paths (e.g. "C:/...").
  if (/^[a-zA-Z]:/.test(normalized)) {
    return 'absolute paths are not allowed';
  }

  // Reject path traversal.
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..')) {
    return 'path traversal ("..") is not allowed';
  }

  return null;
}
