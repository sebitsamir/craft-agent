/**
 * Thin re-export shim. The bounded process runner now lives in the kernel
 * (shared, domain-neutral). Kept here so the software pack's public API and
 * internal relative imports remain unchanged.
 */
export { run } from '@junub-agent/kernel';
export type { RunResult, RunOptions } from '@junub-agent/kernel';
