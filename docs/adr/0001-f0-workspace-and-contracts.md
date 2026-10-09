# ADR 0001: Workspace Structure, Strict TypeScript Baseline, and Contract Isolation

## Status
Accepted (2026-09-29)

## Context
Junub Agent begins as a dependency-free v0.3 Node.js seed capable of software repository inspection, script verification, domain discovery metadata, and task contract validation.
`PRODUCT_BLUEPRINT.md` specifies an evolution toward a multi-domain universal creator with strict type contracts, capability packs, and a domain-neutral kernel.

Phase F0 requires establishing repository discipline without breaking the existing v0.3 CLI behaviors, maintaining single lockfile integrity, and preventing premature empty directory scaffolding.

## Decisions

1. **pnpm Workspaces with Monorepo Package Layout**
   - Adopt `pnpm` (`10.x`) with `pnpm-workspace.yaml` configuring `packages/*`.
   - Use a single authoritative lockfile (`pnpm-lock.yaml`) and remove `package-lock.json`.
   - Do not create empty placeholder packages or premature domain pack folders until their respective milestone gates are reached.

2. **Strict TypeScript Base with Project References**
   - Centralize compilation rules in `tsconfig.base.json` (`target: ES2022`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `declaration: true`).
   - Introduce `@junub-agent/contracts` as the first workspace package containing domain-neutral schemas for tasks, evidence, artifacts, and inspection/verification reports.
   - Maintain the CLI runtime in ESM JavaScript (`src/cli.mjs`) for immediate execution without mandatory bundlers, while validating types via `tsc --build`.

3. **Parity and Architectural Verification**
   - Implement parity tests (`test/parity.test.mjs`) locking down CLI flags (`--out`, `--scripts`), exit codes (0, 1, 2), and json schemas.
   - Implement architecture tests (`test/architecture.test.mjs`) ensuring zero empty packages, single lockfile enforcement, and schema validation.
   - Set up GitHub Actions CI matrix covering Windows and Ubuntu across Node.js 20 and 22.

## Consequences

- **Positive:**
  - Contracts are type-safe and independently versionable across future engine, CLI, and client surfaces.
  - Zero runtime dependencies remain in the core seed.
  - Verified cross-platform CI guarantees reliability on Windows and Linux.
- **Negative / Trade-offs:**
  - Building TypeScript contracts requires running `pnpm run build` or `pnpm run check:types` during development.
