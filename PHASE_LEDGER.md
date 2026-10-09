# Junub Agent phase ledger

Updated: 10 October 2026. The authoritative phase definitions are in PRODUCT_BLUEPRINT.md.

| Phase | State | Evidence | Next gate |
| --- | --- | --- | --- |
| v0.3 seed | Verified locally | Nine tests pass; syntax check; inspect/verify self; film task contract validation | Preserve parity during F0 migration |
| F0 repo discipline | Verified locally | 19 tests pass (9 core + 5 parity + 5 architecture); strict TypeScript workspace with project references; single pnpm-lock.yaml; Windows/Linux CI workflow; zero empty packages; zero CLI regressions | F1 universal contracts: runtime schemas, pack manifest ABI, versioned protocol |
| F1 universal contracts | Partial prototype | Domain-neutral JSON task validator and planned domain metadata; static TypeScript contracts in @junub-agent/contracts | Runtime schemas, pack manifest, versioned protocol, compatibility tests |
| F2 onward | Planned | Architecture and exit gates documented | Begin only after prerequisites pass |

## Current limitations

- The process runner is not an OS sandbox. Run verification only in trusted projects.
- The inspector currently scans the root package manifest; workspace traversal is scheduled for S0.
- CI configuration is committed for Windows and Linux; live remote CI execution awaits push authorization.
- The task validator models impact and reviewer roles; it does not classify real-world risk or verify a reviewer's identity.
- Small local models (e.g., 3B parameters) may struggle with complex structural code repairs; cloud models (72B+) are recommended for the Auto-Fix loop.

## Next ticket

V5: Inline Editor Integration (Right-click context menu for "Ask Junub to explain/refactor selection").

### F1 — Universal Contracts [COMPLETE]
**Exit Gate:** Film and software contracts validate through the same kernel; unsupported capabilities are visibly reported.
**Evidence:** 
- `packages/contracts/test/f1-exit.test.mjs` passes 6/6 tests.
- `validateTaskContract()` handles software, film, and medicine domains identically.
- `resolveCapability()` correctly throws `CAPABILITY_PLANNED` for unsupported domains.
- High-impact reviewer enforcement and duplicate criterion rejection verified.

### F3 — Trust and model foundation [COMPLETE]
**Exit Gate:** One provider, read-only planning, source provenance, secret filtering, eval/security fixtures. No unauthorized file/tool action; cited plans with bounded budget and accurate failures.
**Evidence:** 
- `test/f3-models.test.mjs` passes 8/8 tests.
- `test/f3-knowledge.test.mjs` passes 5/5 tests.
- `test/f3-security-evals.test.mjs` passes 3/3 tests.
- FakeProvider enables deterministic offline planning.
- CapabilityRouter routes by capability, not domain.
- ReadOnlyPlanner rejects mutating/dangerous steps and enforces budgets.
- SecretFilter scrubs API keys, tokens, and exfiltration attempts.
- SourceRegistry binds citations to SHA-256 hashes and flags staleness.

### S0 — Software pack extraction [COMPLETE]
**Exit Gate:** Move inspector/verifier into software pack; repository/workspace mapping. Multi-package fixture and dirty worktree handled; seed parity maintained.
**Evidence:**
- `packs/software/` contains the extracted `inspect`, `verify`, and `process` logic in strict TypeScript.
- `src/lib/` files are thin re-export wrappers preserving CLI parity and zero root dependencies.
- `test/s0-dirty-worktree.test.mjs` proves monorepo mapping and dirty worktree detection.
- All 56 tests pass, including 5 v0.3 CLI parity tests.

### S1 — VS Code experience [COMPLETE]
**Exit Gate:** Task intake, map, plan, progress, diff and evidence. User can inspect/verify Junub Agent and distinguish failed, skipped and timed-out checks.
**Evidence:**
- Extension scaffolding in apps/vscode/ with headless NDJSON transport.
- Inspect and Verify commands run over the protocol with status-distinct webview.
- Task intake command streams live ProtocolEvents into a progress TreeView.
- Green ticks observed in sidebar confirming real-time step state rendering.

### S2 — Dirty worktree handling [COMPLETE]
**Exit Gate:** Repository status captured before and after; clean path applies without overwrite; dirty path preserves work; uncommitted artifacts reported.
**Evidence:**
- captureWorktreesSnapshot() captures branch, HEAD, dirty, changed, and untracked paths.
- diffSnapshots() compares before/after snapshots and reports uncommitted artifacts.
- evaluateWorktreeSafety() + guardedMutation() enforce the clean/dirty decision.
- test/s2-snapshot.test.mjs, test/s2-diff.test.mjs, test/s2-gate.test.mjs all pass.
- Full suite 72/72 green with zero regressions.

### S3 — Scoped patch application [COMPLETE]
**Exit Gate:** Patches apply to a bounded file set only; out-of-scope paths rejected; before/after snapshots recorded; resulting artifacts hash-bound and reported.
**Evidence:**
- Patch model with allowedPaths scope and path-safety validation.
- Scoped applicator with apply-time scope + root-escape re-checks.
- guardedApplyPatch wraps application in the S2 safety gate.
- applyPatchWithReport emits SHA-256-bound PatchArtifactRecords.
- test/s3-patch-model.test.mjs, test/s3-apply.test.mjs, test/s3-artifacts.test.mjs all pass.
- Full suite 99/99 green.

### T0 — Film pack extraction [COMPLETE]
**Exit Gate:** Move inspector/verifier into film pack; project/asset mapping. Multi-asset fixture handled; seed parity maintained.
**Evidence:**
- `packs/film/` contains manifest, project mapper, EDL parser, and media link verifier.
- `src/engine.mjs` routes `pack.film.inspect` and `pack.film.verify` via NDJSON.
- Domain neutrality proven: film assets are mapped and verified by the same engine as software.
- `test/t0-film-pack.test.mjs`, `t0-film-checks.test.mjs`, and `t0-engine-routing.test.mjs` all pass.
- Full suite 104/104 green.

### T1 — Film UI integration [COMPLETE]
**Exit Gate:** Film inspection surfaced in webview with status-distinct media links; film projects browseable in sidebar tree.
**Evidence:**
- 'Junub Agent: Inspect Film Project' command renders film webview with summary cards + linked/missing badges.
- 'Junub Agent: Load Film Project' command populates FilmTreeProvider in Explorer sidebar.
- Shared fetchFilmReport() ensures webview and tree stay in sync.
- UI layer proven domain-neutral: same protocol renders film and software data.

### T2 — Film scoped patching [COMPLETE]
**Exit Gate:** Film assets protected by the worktree gate; media immutability enforced; safe film edits reachable end-to-end.
**Evidence:**
- Safety machinery lifted into the kernel (domain-neutral); software pack is a thin shim.
- applyFilmPatch enforces media immutability and re-verifies media links after apply.
- pack.film.applyPatch routed through the engine; VS Code 'Apply Film Patch' command.
- test/t2-shared-safety, t2-film-patch, t2-engine-patch all pass. Full suite 114/114.

### E1 — Real task execution [COMPLETE]
**Exit Gate:** Tasks execute via the kernel executor with durable events; crash-replay resumes without duplicate work.
**Evidence:**
- runTask() bridges task contracts to executeStep() with state replay + idempotency.
- Engine task.run replaced simulation with genuine runTask() execution.
- StreamingEventStore streams every durable kernel event to the UI in real time.
- FileEventStore (JSONL) persists events across process death.
- e1-crash-replay proves a killed engine resumes without re-running completed steps.
- Full suite 119/119 green.

### E2 — Real step actions [COMPLETE]
**Exit Gate:** Engine executes real, safety-guarded domain work via declarative plans instead of simulated stubs.
**Evidence:**
- `src/lib/actions.mjs` maps action kinds to real capability calls (inspect, verify, applyPatch).
- Engine `task.run` accepts an optional `plan` parameter to route steps to real actions.
- `e2-e2e-task.test.mjs` proves a multi-step plan genuinely mutates the filesystem and completes durably.
- Full suite 124/124 green.

### E3 — Real model provider integration [COMPLETE]
**Exit Gate:** Real LLM provider implements the ModelProvider port and is routed by the CapabilityRouter.
**Evidence:**
- QwenProvider implements `complete`, `listModels`, and `isAvailable`.
- Maps token usage to `ModelUsage` for kernel budget enforcement.
- Classifies API errors (401, 429, 5xx) into `JunubErrorCode` for deterministic retry.
- CapabilityRouter correctly selects models based on cost and capabilities.
- e3-router-integration test proves deterministic routing and failure honesty.

### E4 — Plan-to-Execution Bridge [COMPLETE]
**Exit Gate:** Validated model proposals are compiled into executable, kernel-guarded steps; unsafe proposals are rejected.
**Evidence:**
- ReadOnlyPlanStep carries an optional proposedPatch payload.
- compilePlan() validates patches via the kernel patch model before compilation.
- Valid patches compile to applyPatch/film.applyPatch; invalid patches throw MALFORMED_ARTIFACT.
- High-impact tasks still require a named reviewer (F1 governance).
- e4-plan-bridge and e4-patch-bridge tests prove the strict security boundary.
- Full suite 148/148 (2 live-API skips).

### E5 — Real LLM Brain in the Engine [COMPLETE]
**Exit Gate:** Engine dynamically selects real Qwen provider via VS Code settings, falling back to FakeProvider offline.
**Evidence:**
- VS Code settings (`junubAgent.dashscopeApiKey`, `qwenBaseUrl`, `qwenModel`) inject into engine env.
- `selectModelProvider()` routes to QwenProvider with custom model support (e.g., OpenRouter).
- Planner robustly handles LLM quirks (markdown wrappers, missing source fields).
- End-to-end flow proven: Real Qwen plan → Webview review → Bridge compile → Durable execution → Live UI progress.

### V1 — VS Code Plan Review UI [COMPLETE]
**Exit Gate:** Human reviews model-proposed plans in the editor before execution.
**Evidence:**
- Webview renders task, steps, proposed patches with Approve/Reject controls.
- runTask command drives task.plan → review → task.compile → task.run.
- Task Progress tree streams task.created → step.* → task.succeeded in real-time.
- Bridge security boundary enforced at compile time (readOnly, reviewer, patches).

### V2 — Plan History & Audit Trail [COMPLETE]
**Exit Gate:** Agent actions are permanently logged and viewable in the editor.
**Evidence:**
- Engine appends `plan_generated` and `task_completed`/`task_failed` events to `.junub/history.jsonl`.
- `junubAgent.viewHistory` command opens a Webview displaying chronological task history.
- UI robustly resolves the history file path across different workspace configurations.

### V3 — Deep History Inspection [COMPLETE]
**Exit Gate:** Full audit trail of LLM proposals and kernel executions.
**Evidence:**
- Engine logs `plan` (steps, sources, patches) and `executedSteps` to `.junub/history.jsonl`.
- History Webview groups records by `taskId` with expandable/collapsible detail views.
- UI renders step cards with action types, descriptions, source citations, and proposed patches.
- Displays execution status, completed steps, and any errors for full auditability.

### O1 — Local LLM Support (Ollama) [COMPLETE]
**Exit Gate:** Agent can plan tasks entirely offline using a local LLM.
**Evidence:**
- VS Code settings include `junubAgent.provider` dropdown (dashscope, openrouter, ollama).
- Auto-configures `http://localhost:11434/v1` and bypasses strict API key checks for local URLs.
- Successfully tested with `qwen2.5:3b` on 8GB RAM hardware.
- Full end-to-end flow (Plan → Review → Compile → Execute → History) works identically offline.

### V4 — Chat Workspace Context (Cursor-like RAG) [COMPLETE]
**Exit Gate:** Chat provides grounded, accurate answers based on the real file system.
**Evidence:**
- Chat UI silently scans workspace directories and `package.json` before every query.
- Engine receives real workspace context and injects it into the local LLM system prompt.
- Verified: Asking "summarize the architecture" yields a real breakdown of the `packages/` monorepo structure.
- Verified: Asking "what tech stacks" correctly deduces TS/Node based on `tsconfig.json` and `.d.ts` files.

### V5 — Terminal Execution & Agentic Auto-Fix Loop [COMPLETE]
**Exit Gate:** Agent executes shell commands, diagnoses failures, applies surgical patches, and automatically verifies/reverts changes to protect codebase integrity.
**Evidence:**
- `chat.run` executes shell commands with full stdout/stderr capture, exit codes, and Windows `.cmd` shell support via `process.mjs`.
- `chat.diagnose` analyzes ANSI-stripped terminal errors to identify the exact broken file and root cause.
- `chat.edit` generates and applies `SEARCH/REPLACE` patches with fuzzy-matching fallbacks for small model resilience.
- Auto-Revert Guardrail automatically re-runs the originating build command post-fix; restores `.bak` backups if verification fails.
- Upgraded provider routing to support OpenRouter (`qwen-2.5-72b-instruct`) for deep structural reasoning alongside local Ollama.
- Chat UI upgraded with persistent Result Cards, single updating status bars, and Auto-Fix action buttons.
- End-to-end verified: Agent caught a Next.js syntax error, diagnosed the missing bracket, applied the patch, and verified the build passed.
