# Craft Agent phase ledger

Updated: 29 September 2026. The authoritative phase definitions are in PRODUCT_BLUEPRINT.md.

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| v0.3 seed | Verified locally | Nine tests pass; syntax check; inspect/verify self; film task contract validation | Preserve parity during F0 migration |
| F0 repo discipline | In progress | README, AGENTS.md, master plan and prompt exist | Git repository, strict TypeScript/pnpm workspace, Windows/Linux CI |
| F1 universal contracts | Partial prototype | Domain-neutral JSON task validator and planned domain metadata | Runtime schemas, pack manifest, versioned protocol, compatibility tests |
| F2 onward | Planned | Architecture and exit gates documented | Begin only after prerequisites pass |

## Current limitations

- No AI model, editor UI, artifact store, scheduler, renderer, game engine, scientific engine or qualified professional review.
- The process runner is not an OS sandbox. Run verification only in trusted projects.
- The current inspector understands a root package.json, not nested workspaces.
- The Windows npm invocation path is designed but not yet validated in Windows CI.
- The task validator models impact and reviewer roles; it does not classify real-world risk or verify a reviewer's identity.

## Next ticket

F0-01: establish the repository, CI and strict workspace without losing the v0.3 CLI behaviors. Create fixture outputs for inspect, verify and validate-task first; migrate one module at a time. Review each diff and do not commit without explicit owner authorization.
