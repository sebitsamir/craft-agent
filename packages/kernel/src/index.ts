/**
 * Public API for @junub-agent/kernel.
 *
 * Kernel must remain domain-neutral.
 * It must not contain software-specific, film-specific, or game-specific logic.
 */

export * from './failure.js';
export * from './budget.js';
export * from './port/event-store.js';
export * from './port/action-guard.js';
export * from './state/task-run.js';

// F2 Slice 2: Scheduler and Execution Engine
export * from './scheduler/retry.js';
export * from './scheduler/cancel.js';
export * from './scheduler/executor.js';

// Workspace mutation safety (shared, domain-neutral) — lifted from the
// software pack in T2 so every domain pack can reuse the same gate.
export * from './process.js';
export * from './worktree/snapshot.js';
export * from './worktree/diff.js';
export * from './worktree/gate.js';
export * from './patch/model.js';
export * from './patch/apply.js';
export * from './patch/artifacts.js';

export * from './task-runner.js';