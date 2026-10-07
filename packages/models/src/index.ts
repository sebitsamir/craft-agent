/**
 * Public API for @junub-agent/models.
 *
 * This package owns model provider ports, capability routing, and
 * read-only planning. It does NOT own task policy, artifact storage,
 * or tool execution.
 *
 * Dependency direction:
 * - models -> contracts (types)
 * - models -> kernel (budget types)
 * - kernel -> models (NEVER; kernel uses ports only)
 */

// Provider port interface (the "brain socket").
export * from './ports/model-provider.js';

// Capability-based routing.
export * from './routing/capability-router.js';

// Deterministic fake provider for testing.
export * from './adapters/fake-provider.js';

export * from './providers/qwen-provider.js';

// Read-only planning layer.
export * from './planning/read-only-planner.js';
export * from './planning/plan-bridge.js';
