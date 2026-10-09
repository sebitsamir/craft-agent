# Contributing to Junub Agent

Junub Agent follows phased gates defined in [PRODUCT_BLUEPRINT.md](../PRODUCT_BLUEPRINT.md) and tracked in [PHASE_LEDGER.md](../PHASE_LEDGER.md).

## Prerequisites

- **Node.js**: >= 20.0.0
- **pnpm**: >= 10.0.0
- **Git**: >= 2.30

## Getting Started

1. Clone or open the repository.
2. Install dependencies:
   ```bash
   pnpm install --frozen-lockfile
   ```
3. Build contracts and check types:
   ```bash
   pnpm run build
   pnpm run check
   ```
4. Run all unit, parity, and architecture tests:
   ```bash
   pnpm test
   ```

## Development Guidelines

- **No Premature Scaffolding**: Never create empty placeholder directories or packages for future phases.
- **Strict Parity**: The existing CLI commands (`inspect`, `verify`, `domains`, `validate-task`) must retain their schemas, options, and exit codes.
- **Domain Separation**: Keep the kernel and shared contracts domain-neutral. Domain-specific logic belongs in capability packs (Phase S0+).
- **Zero Runtime Dependencies in Core**: The seed runs dependency-free. Tooling dependencies belong strictly in `devDependencies`.
- **Review and Commit Authority**: Do not commit, push, or run irreversible operations without explicit owner authorization.
