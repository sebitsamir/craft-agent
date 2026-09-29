# Craft Agent Starter Findings Report

**Date:** 29 September 2026  
**Scope:** v0.3 CLI Seed and Repository Baseline Audit  
**Author:** Craft Agent Implementation Team

---

## 1. Executive Summary

The v0.3 seed provides a working, dependency-free foundation for software repository inspection, script verification, domain discovery, and task contract validation. However, as documented in `PRODUCT_BLUEPRINT.md`, the seed was initially an unversioned single-package project with no CI, no static type enforcement, and several security and architectural limitations that must be addressed across phases F0–S4.

---

## 2. Findings by Category

### A. Missing Contracts & Schemas (Resolved in F0 / F1)
1. **Unversioned In-Memory Schemas:**
   - *Observation:* The seed returned ad-hoc JSON objects (`schemaVersion: 1`) without formal TypeScript interfaces or runtime schema definitions.
   - *Fix in F0:* Created `@craft-agent/contracts` with strict TypeScript definitions for `TaskContract`, `DomainMeta`, `InspectionReport`, `VerificationReport`, `ArtifactReference`, and `EvidenceRecord`.
   - *Next in F1:* Add runtime validation schemas and serialized protocol event types.

2. **Artifact & Evidence Decoupling:**
   - *Observation:* Task contracts defined output formats and evidence methods, but no model existed to bind an evidence result to a specific artifact hash or content address.
   - *Next in F1/F2:* Content-addressed artifact storage and immutable evidence bundles.

### B. Security Boundaries & Process Execution
1. **Child Process Execution is Not a Sandbox:**
   - *Observation:* `src/lib/process.mjs` executes commands via `node:child_process` `spawn`. While bounded by timeouts and buffer limits, it executes with the user's host OS privileges.
   - *Mitigation:* Explicitly documented in `AGENTS.md` and CLI headers. Safe script regex prevents argument injection into shell wrappers (`ComSpec`). Full OS-level containerization/sandboxing scheduled for Phase S4.

2. **Windows Command Invocation Shim:**
   - *Observation:* On Windows, npm commands require `cmd.exe /d /s /c "npm run <script>"`. While script names are validated against `/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/`, execution inherits environment variables directly.
   - *Status:* Windows/Linux CI workflow created in `.github/workflows/ci.yml` to prevent platform-specific regressions.

### C. Mismatches with Universal Creator Goal
1. **Software-Centric Verification Bias:**
   - *Observation:* `verify` only understands `package.json` npm scripts (`check`, `test`). Non-software domains cannot be verified by `npm run`.
   - *Remedy:* Keep kernel verification adapter-based; domain packs will register their own verifiers and validators in Phase S0+.

2. **Reviewer Role is a Unchecked String:**
   - *Observation:* High-impact tasks require `review.role` (e.g. `"licensed clinician"`), but this is merely a metadata check, not identity or credential verification.
   - *Remedy:* Clearly documented in validation warnings and CLI summaries.

---

## 3. Prioritized Fixes & Roadmap

| Priority | Ticket / Milestone | Focus Area | Status |
| --- | --- | --- | --- |
| **P0** | **F0-01** | Git, strict TS workspace, CI, parity & architecture tests | **Completed** |
| **P1** | **F1-01** | Runtime schemas (Zod/TypeBox), pack manifest ABI, protocol envelope | Next |
| **P2** | **F2-01** | Local SQLite event store, durable scheduler, artifact store | Planned |
| **P3** | **S0-01** | Extract software pack from seed into `packs/software` | Planned |
