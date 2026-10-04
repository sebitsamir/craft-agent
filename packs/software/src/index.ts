/**
 * Public API for @craft-agent/pack-software.
 *
 * This is the first real capability pack, extracted from the v0.3 seed.
 * It provides repository inspection, script verification, and task
 * validation through the Capability Pack interface.
 *
 * The inspect() and verify() functions are exact ports of the v0.3 seed
 * and produce byte-identical output, preserving CLI parity.
 */

// Manifest loading and validation.
export * from './manifest.js';

// Repository and workspace mapping.
export * from './repository.js';

// Bounded child-process runner (used by inspect and verify).
export * from './process.js';

// Domain checks — exact ports of the v0.3 seed.
export * from './checks/inspect.js';
export * from './checks/verify.js';

// Worktree safety (S2).
export * from './worktree/snapshot.js';
export * from './worktree/diff.js';
export * from './worktree/gate.js';

// Scoped patch application (S3).
export * from './patch/model.js';
export * from './patch/apply.js';
export * from './patch/artifacts.js';
