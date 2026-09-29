# Craft Agent phase ledger

Updated: 29 September 2026. The authoritative phase definitions are in PRODUCT_BLUEPRINT.md.

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| v0.3 seed | Verified locally | Nine tests pass; syntax check; inspect/verify self; film task contract validation | Preserve parity during F0 migration |
| F0 repo discipline | Verified locally | 19 tests pass (9 core + 5 parity + 5 architecture); strict TypeScript workspace with project references; single pnpm-lock.yaml; Windows/Linux CI workflow; zero empty packages; zero CLI regressions | F1 universal contracts: runtime schemas, pack manifest ABI, versioned protocol |
| F1 universal contracts | Partial prototype | Domain-neutral JSON task validator and planned domain metadata; static TypeScript contracts in @craft-agent/contracts | Runtime schemas, pack manifest, versioned protocol, compatibility tests |
| F2 onward | Planned | Architecture and exit gates documented | Begin only after prerequisites pass |

## Current limitations

- No AI model, editor UI, artifact store, scheduler, renderer, game engine, scientific engine or qualified professional review.
- The process runner is not an OS sandbox. Run verification only in trusted projects.
- The inspector currently scans the root package manifest; workspace traversal is scheduled for S0.
- CI configuration is committed for Windows and Linux; live remote CI execution awaits push authorization.
- The task validator models impact and reviewer roles; it does not classify real-world risk or verify a reviewer's identity.

## Next ticket

F1-01: Implement runtime schemas (Zod or TypeBox) and validation for TaskContract, ArtifactReference, and EvidenceRecord; define the local protocol request and event envelopes with serialization tests.
