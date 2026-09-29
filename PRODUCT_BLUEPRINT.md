# Craft Agent — Universal Creator Master Specification

**Version:** 2.0 planning baseline, 29 September 2026  
**Working name:** Craft Agent; branding is provisional and must be checked before public use.  
**Current implementation:** v0.3 dependency-free CLI seed. It inspects software repositories, runs selected declared npm scripts, lists domain metadata, and validates a domain-neutral task contract. It does not generate films, games, medical work, legal work, or other non-software artifacts yet.  
**North star:** A trustworthy creator that helps people turn an idea into a usable, reviewable artifact across many fields, while clearly representing what it knows, what it made, what was tested, who reviewed it, and what remains uncertain.

## 0. Decision in one page

Build a **local-first creation platform**, beginning with software engineering as its first fully tested capability pack. The platform's core is domain-neutral from the beginning: project identity, task contracts, typed artifacts, workflow execution, permissions, evidence, provenance, model routing, versioning, review, and recovery. Domain packs supply their own tools, knowledge sources, validators, risk rules, and user interfaces.

The first product should help its owner build and verify the platform itself. After the software pack is dependable, add creative and scientific packs, then carefully governed professional workflows. Avoid a large interface promising every domain on day one. An unsupported domain must say “planned” or “requires a specialist,” not produce a convincing-looking but unverified answer.

**Definition of a completed creation:** the requested artifact exists in the required format; it opens or runs; acceptance criteria have relevant evidence; rights, sources and risk obligations have been recorded; a human can inspect and revise it. Some subjective or high-stakes criteria require a named reviewer.

The product cannot guarantee it will solve every error. Its reliability promise is that it will make bounded progress, diagnose a failure, change hypothesis when evidence demands it, and report an exact next step when blocked. It must not spin, hide a failed tool, fabricate evidence, or mark unsupported work complete.

## 1. Review of the preceding software-only design

The v1 blueprint had a sound separation between UI, engine, repository context, models, tools, evidence and verification. It correctly prioritized dirty-worktree preservation, provenance and self-hosting. Its **scope was too narrow for this goal**: a code repository was the implicit workspace, a patch was the primary artifact, npm scripts were the main verification path, and a VS Code extension was the main user surface.

The revised invariant is **Project -> Task -> Workflow -> Artifact versions -> Evidence -> Review decision**. A repository is one project resource; a patch is one artifact transformation; software tests are one verification adapter; VS Code is one client. This shift is made now, before the platform engine and storage schema exist.

The v0.3 seed adds:
- Domain-neutral task fields: title, intent, domain, outputs, impact, acceptance criteria and evidence methods.
- Validation of missing or duplicate criteria and a named reviewer role for high-impact tasks.
- Honest domain listings: software is a bootstrap capability; film, game, medicine, accounting, law, education and astronomy are planned.
- Two examples that show creative and scientific acceptance evidence.
- The existing v0.2 inspector and verifier with six regression tests. There are nine tests in v0.3.

**Limits of the seed:** metadata and validation are not professional judgment, a media engine, a sandbox, a qualified-reviewer identity check, or a completed domain pack. A declared “high” impact is user input, not an adequate risk classifier. These gaps become explicit phase gates.

## 2. Competitive landscape and product hypothesis

Official public sources consulted on 29 September 2026, not private product code or hands-on comparative testing:

| Product area | Existing strengths | What Craft Agent must prove |
| --- | --- | --- |
| Cursor | Editor agent, shell, browser, checkpoints, rules, cloud and predictive Tab completion [C1][C2] | A more transparent project/evidence loop on real tasks, not merely chat or autocomplete |
| Codex | CLI/IDE/cloud, worktrees, review, sandbox/approvals and agent workflows [O1][O2] | Cross-domain artifact contracts and quality gates, while matching reliability in the software wedge |
| Claude Code | Tools, hooks, skills, subagents, permissions and checkpoints [A1][A2] | Persistent goals/evidence and explicit rollback/side-effect boundaries across long workflows |
| Adobe Firefly / Canva | Mature media/design creation surfaces and multi-model creative workflows [M1][M2] | Connected, editable projects that can span script, media, app, game and learning assets with provenance |
| Unity AI tooling | In-project game assistant and asset/workflow tools [G1] | Orchestration across engines and disciplines, with playable-build validation instead of isolated assets |

These are **hypotheses**. No claim of superiority until a common task suite, budget and independent human review demonstrate it. The product can compete through reliable cross-domain handoffs rather than trying to train the best model for every medium.

## 3. Audience, modes and scope

**Novice mode:** guided brief, examples, plain-language controls, milestones, previews, visible cost and decisions.  
**Professional mode:** explicit constraints, reproducible environments, source and version controls, reviewer roles, automation and export.  
**Team mode (later):** shared projects, role-based permissions, approvals, comments, audit and organization policy.

**Creation modes**
1. Explore: research, compare options and refine a brief; no external mutation.
2. Plan: produce a versioned artifact graph, estimated tools, rights, validation and budget.
3. Create: generate/edit assets under scoped permissions.
4. Test: use domain validators and real previews.
5. Review: side-by-side versions, evidence, sources, rights and open issues.
6. Publish/hand off: export or external action with a separate explicit authorization.

**Example project:** a user creates a science-fiction short film, a small playable game in the same world, classroom material explaining the orbital mechanics, and a companion website. The project shares approved characters, style guide, facts and rights data. Each domain retains separate evidence: video playback and editorial review, playable build and frame-time check, educational learning review, calculations with units and sources, and website tests.

**Scope progression:** software first for dogfooding; film/storyboard and education/astronomy as early cross-domain pilots; games and heavier media pipelines later; medicine, accounting and law limited to carefully scoped assistance until independent domain expertise and jurisdiction-specific validation exist.

## 4. Domain capability matrix

These are target workflows, not current implementations.

| Domain | Editable output examples | Domain evidence | Additional control |
| --- | --- | --- | --- |
| Software | Source, app, API, test, design system | Typecheck, build, tests, runtime/browser flow, diff | Scoped command execution, Git/worktree integrity |
| Film/video | Script, shot list, storyboard, timeline, footage, audio, final video | Media probe, playback, duration, continuity review, render provenance | Rights, voice/likeness consent, human creative review |
| Game | Design, assets, scene, code, playable build | Editor import, play-mode test, platform build, performance, playtest | Engine licenses, asset rights, target-device support |
| Medicine | Educational explainer, research synthesis, structured draft | Current primary sources, uncertainty, expert review | No autonomous diagnosis/treatment or clinical action; qualified governance before consequential use |
| Accounting | Worksheet, reconciliations, draft report | Double-entry/reconciliation checks, data lineage, reviewer signoff | Jurisdiction/standard selection; no autonomous filing, payment or certification |
| Law | Research outline, clause comparison, draft memo | Jurisdiction/date, primary authority checks, citation verification, lawyer review | Confidentiality, legal professional oversight, no autonomous representation |
| Education | Lesson, assessment, interactive module | Objective alignment, factual check, accessibility, educator/student feedback | Age-appropriate use, student privacy, educator controls |
| Astronomy/space | Calculation, simulation, plot, research report | Units, independent numeric check, uncertainty, ephemeris/source date | Explicit assumptions and scientific reproducibility |
| General/custom | Brief, document, prototype, structured dataset | User-defined criteria and independent review | Pack must declare capabilities and quality boundaries |

WHO cautions that broad capabilities of large multimodal models across health purposes are not yet proven [H1]. UNESCO emphasizes human-centered, age-appropriate educational design and privacy [E1]. The ABA's US legal ethics guidance stresses professional duties when lawyers use generative AI [L1]; requirements elsewhere must be researched separately. These sources motivate domain-specific gates, not universal restrictions on harmless educational or fictional tasks.

For media, record origin and licenses; consider interoperable provenance such as C2PA where a format/provider supports it [P1]. Copyright and likeness questions depend on jurisdiction and source rights; a generation API response is not proof of ownership [P2].

## 5. Product experience

### 5.1 Project Studio

A project has a brief, people/roles, resource library, artifact graph, task board, activity timeline and review area. The home screen shows **next useful action**, not a wall of agent messages. Progressive disclosure reveals advanced tool and provenance details without hiding consequential actions.

### 5.2 Creation canvas

Select or combine a suitable view: document editor, storyboard/timeline, image/audio/video preview, code/diff, game preview, spreadsheet/table, diagram, or scientific plot. The platform stores editable source plus rendered output. A generated image embedded in a movie does not replace the editable shot/timeline project.

### 5.3 Task run

Intake -> contract -> capability check -> plan -> approval -> execution -> verification -> review -> accepted/needs revision/blocked. A task may contain a directed graph of subtasks. The graph is visible, cancellable and resumable. The user can steer a running task; a revised constraint creates a new contract version.

### 5.4 Completion report

Show outputs with working download/open paths, preview, source/rights panel, validation results, reviewer status, cost, version history, unresolved risks and exact rollback scope. “Created” is different from “verified,” “expert-reviewed,” and “published.”

### 5.5 Accessibility and reach

Keyboard and screen-reader support, reduced motion, localization-ready copy, low-bandwidth previews, resumable uploads, offline inspection and local drafts. The desktop/CLI core must work on an 8 GB Windows PC for text and code. High-resolution video, simulation or large model inference can use optional isolated workers with an explicit cost/transfer decision.

## 6. Domain-neutral object model

- **Workspace:** local or remote storage roots and grants. A Git repository is an optional linked resource.
- **Project:** owner, purpose, collaborators, policy, budget, resources, artifact graph and history.
- **TaskContract:** intent, domain(s), desired outputs, constraints, acceptance criteria, impact, reviewer roles, deadlines, budget, policy version and sources; immutable versions.
- **Plan:** graph of typed steps, expected tools, outputs, prerequisites, verification and cost.
- **StepRun:** state, attempts, idempotency key, inputs/outputs, execution environment, logs and error category.
- **Artifact:** stable ID, type, MIME/format, editable source reference, content hash, lineage, license and provenance; immutable versions with latest pointer.
- **Evidence:** criterion ID, method, target artifact hash, status, environment, source/version/date, bounded output and reviewer.
- **Approval:** actor, action, scope, expiry, time, decision and policy basis.
- **Decision:** accepted, revised, rejected or published; actor and reviewed version.
- **CapabilityPack:** versioned manifest, tool scopes, formats, validators, examples, risk rules and eval set.

**Core invariant:** every claim about a created artifact refers to a specific version and evidence set. An edit invalidates affected checks until they are rerun. A required criterion that is FAILED, BLOCKED or NOT_RUN cannot be silently shown as VERIFIED. Domain-specific criteria determine what “good” means; a single universal quality score is prohibited.

### Artifact lineage

Store transformations as edges: input hashes + tool/model/version + parameters + output hash + permissions + review. Keep an original source and editable project file where possible, not only flattened export. Deduplicate blobs by hash locally, with user-facing deletion that understands shared references.

## 7. Kernel and execution engine

### 7.1 Runtime boundaries

The kernel coordinates contracts, state and policy. It never contains a hard-coded “if medicine then use this prompt” maze. Packs register capabilities and validators through a versioned interface. Tool adapters perform file, browser, media, scientific compute or external application actions. The model proposes steps; the runtime validates every tool input and decides whether an action may execute.

~~~mermaid
flowchart TB
  Clients["Desktop / Web / CLI / Editor"] --> API["Versioned task API"]
  API --> Kernel["Contracts, scheduler, policy"]
  Kernel --> Packs["Capability packs"]
  Kernel --> Models["Model router"]
  Kernel --> Store["Projects, artifacts, evidence"]
  Packs --> Tools["Isolated tool adapters"]
  Tools --> Store
~~~

### 7.2 Step states and anti-stall rules

States: QUEUED, RUNNING, INPUT_REQUIRED, APPROVAL_REQUIRED, RETRY_WAIT, BLOCKED, FAILED, CANCELLED, SUCCEEDED, VERIFIED. Every transition is recorded. A step is VERIFIED only if its required evidence is current for the artifact version.

Classify failure as TRANSIENT (rate limit/network/process restart), FIXABLE (validation/test failure), MISSING_INPUT, POLICY_BLOCKED, UNSUPPORTED, EXTERNAL_STATE_UNKNOWN or TERMINAL. Apply bounded exponential retry only to idempotent transient calls. On repeated identical failure, stop repeating the same action; gather new diagnostics or revise the plan. A repair attempt consumes an explicit budget. If no safe next action exists, return the precise blocker and resume handle. An external mutation with unknown outcome is reconciled before retry.

Cancellation propagates to child jobs, but the engine distinguishes “cancel requested” from “process stopped.” Long jobs persist progress and checkpoints; a client disconnect does not erase truth. Future cloud steps use durable queues, leases, heartbeats and idempotency keys.

### 7.3 Self-improvement

The platform can run a task against its own source, but cannot silently change its policies, tests, evaluation rubric or release gate to declare success. Architecture or policy changes require a separate review. Benchmark fixtures should flag deleted tests and weakened assertions. Human acceptance remains necessary.

## 8. Capability pack interface

A pack manifest declares: id/semver, supported task intents, input/output artifact schemas, required tools and permissions, source registries, model capability requirements, validators, risk controls, UI panels, sample tasks, test fixtures, compatibility and maintainer signature. A pack cannot request more permission merely by adding prompt text. Installation is explicit, and each pack runs with least privilege and resource limits.

**Registration checks:** schema validation, semantic version negotiation, dependency constraints, threat review, fixtures and evals, license/source record. A custom pack can be loaded in developer mode but is labeled unreviewed. UI shows capability status: installed, planned, unavailable, or restricted for this task.

**Inter-pack handoff:** a film pack may consume a character bible from a writing pack or a physically grounded orbit animation from an astronomy pack. The receiving pack validates format, rights, units and assumptions; it does not accept raw natural-language output as verified evidence.

**Initial packs:** software (real first pack), writing/research, design/media, education and astronomy pilots. High-stakes packs require qualified review workflow and local legal/regulatory analysis before public consequential use.

## 9. Complete target repository structure

Legend: **NOW** exists in v0.3; **F** is foundation; **S** is software first pack; **U** is universal expansion; **R** is regulated governance; **L** is later scale. Do not create empty directories in advance.

~~~text
craft-agent/
├── README.md                            NOW; honest status and setup
├── PRODUCT_BLUEPRINT.md                 NOW; authoritative universal spec
├── MASTER_PROMPT.md                     NOW; reusable phase-by-phase prompt
├── PHASE_LEDGER.md                     NOW; verified state and next gate
├── AGENTS.md                            NOW; contributor and agent rules
├── package.json                         NOW; migrate to workspace at F0
├── package-lock.json                    NOW; replace with one workspace lockfile at F0
├── .gitignore                           NOW; add generated assets/cache exclusions
├── examples/
│   ├── film-task.json                   NOW; contract only
│   └── astronomy-task.json              NOW; contract only
├── src/                                NOW; transitional seed, retire after parity
│   ├── cli.mjs
│   └── lib/{inspect,process,verify,domains,task-contract}.mjs
├── test/                               NOW; seed regression tests
│   ├── core.test.mjs
│   └── task-contract.test.mjs
├── pnpm-workspace.yaml                  F0; apps/* packages/* packs/*
├── pnpm-lock.yaml                       F0; single dependency graph
├── tsconfig.base.json                   F0; strict and incremental
├── eslint.config.mjs                    F0; boundaries and quality
├── .editorconfig                        F0
├── .github/workflows/
│   ├── ci.yml                           F0; Windows/Linux/macOS matrix
│   └── security.yml                     F3; dependency/secret checks
├── apps/
│   ├── cli/src/                         F1; headless user commands
│   ├── vscode/src/                      S1; editor and diff client
│   ├── desktop/src/                     U2; Project Studio and local engine client
│   ├── web/src/                         L1; remote collaboration client
│   └── api/src/                         L1; optional cloud API
├── packages/
│   ├── protocol/src/                    F1; schema/version/errors/events
│   ├── contracts/src/                   F0; project/task/artifact/evidence types
│   ├── kernel/src/
│   │   ├── state/                       F1; task and step transitions
│   │   ├── scheduler/                   F2; DAG, budgets, retry and resume
│   │   ├── policy/                      F2; typed decisions and grants
│   │   └── ports/                       F1; models/tools/store/pack interfaces
│   ├── artifacts/src/
│   │   ├── blobs/                       F2; content-addressed storage
│   │   ├── lineage/                     F2; transformations and versions
│   │   ├── formats/                     U1; import/export/preview
│   │   └── rights/                      U1; source, license and consent metadata
│   ├── evidence/src/
│   │   ├── checks/                      F2; criterion-bound results
│   │   ├── provenance/                  F2; source and artifact chain
│   │   └── reports/                     F2; review bundles
│   ├── workspace/src/                   F1; roots, Git, resources, access
│   ├── knowledge/src/                   F3; retrieval, source freshness and citations
│   ├── models/src/                      F3; provider adapters, usage and routing
│   ├── tools/src/
│   │   ├── filesystem/                  F2; bounded access
│   │   ├── process/                     F2; execution and cancellation
│   │   ├── browser/                     S3; UI validation
│   │   ├── media/                       U2; render/probe/timeline adapters
│   │   └── compute/                     U3; numeric/simulation adapters
│   ├── packs/src/                       F1; manifest loader and capability registry
│   ├── storage/src/
│   │   ├── sqlite/                      F2; local metadata and migrations
│   │   ├── redaction/                   F2; trace filtering
│   │   └── remote/                      L1; optional object/DB adapters
│   ├── ui-system/src/                   U2; accessible shared components
│   ├── evaluation/src/                  F3; task harness and rubrics
│   └── completion/src/                  S5; low-latency coding suggestions
├── packs/
│   ├── software/
│   │   ├── manifest.json                S0; real tool/validator registration
│   │   ├── src/{repository,patch,checks}/ S0–S3
│   │   ├── test/                        S0–S3
│   │   └── evals/                       S3
│   ├── writing/                         U1; draft/research pack
│   ├── film/                            U2; script/storyboard/timeline/render
│   ├── game/                            U3; engine/project/playable build
│   ├── education/                       U2; lessons and assessments
│   ├── astronomy/                       U3; units, ephemeris and simulation
│   ├── medicine/                        R1; limited, reviewed workflows
│   ├── accounting/                      R2; reconciliations and review
│   └── law/                             R2; jurisdictional source review
├── workers/
│   ├── render/                           L1; isolated GPU/media jobs
│   ├── build/                            L1; isolated code/game builds
│   └── compute/                          L1; isolated scientific jobs
├── fixtures/
│   ├── repositories/                    F1/S0
│   ├── documents-media/                 U1/U2
│   ├── scientific/                      U3
│   └── adversarial/                     F3/R1
├── evals/
│   ├── cross-domain/                    U3; multi-pack handoffs
│   ├── privacy-security/                F3
│   └── human-review/                    U3/R1
├── docs/
│   ├── adr/                             F0; decisions and reversals
│   ├── protocols/                       F1; versioning and compatibility
│   ├── domain-pack-sdk.md               U1
│   ├── threat-model.md                  F2
│   ├── contributing.md                  F0
│   ├── product-research.md              F0
│   └── release.md                       S4
└── scripts/                             F0; reproducible setup/release
~~~

**Dependency direction:** clients -> protocol/kernel ports. Kernel -> contracts only and narrow ports. Adapters implement ports. Packs depend on the SDK/ports and domain tools, never on app UI internals. Storage does not decide task policy. No deep imports across packages. CI checks cycles, package public exports, migrations and schema compatibility. Keep packs in one monorepo while few; publish an SDK only after its contracts stabilize.

## 10. Protocol, storage and distributed future

**Local transport:** spawned engine with newline-delimited, length-bounded JSON. Stdout is protocol only; stderr is diagnostic. Request envelope: version, requestId, method, projectId, taskId, params, idempotencyKey. Event: version, taskId, monotonically increasing sequence, eventId, timestamp, type, payload. Handshake negotiates capabilities and schema range. The client can replay events after a sequence; unknown versions fail explicitly.

**Local store:** SQLite WAL for project/task/event/approval/check metadata, plus content-addressed blobs for artifacts, thumbnails and bounded logs. Migrations are tested against old snapshots and backed up before applying. User controls retention, export and delete. Sensitive content is excluded or redacted before persistence where possible; encrypted storage and OS key store are needed for credentials.

**Remote later:** separate tenant IDs and authorization at every request, durable queue, isolated worker lease/heartbeat, blob storage, versioned API, audit and regional data controls. Cloud is an optional execution adapter, not a prerequisite for the local product. A media render is expensive and may need remote GPU; cost and provider are explicit before upload.

**MCP and external tools:** use official protocol implementations when integrating; do not conflate internal event API with MCP. As of the 2026-07-28 MCP revision, its stateless core, authorization changes and Tasks extension affect integration design [I1]. Scope each third-party tool and validate returned content as untrusted.

## 11. Models, memory and knowledge

Use capability-based routing: reasoning/tool use, vision, image/audio/video generation, code completion and embedding, with provider adapters and reproducible model identifiers. The system should not pretend one model excels at every domain. Each route advertises formats, latency, cost, context limits, privacy destination and failure modes. A fallback model is used only when its capability meets the task contract and the user budget/privacy policy allows it.

**Memory layers:** user preferences (explicit and editable), project facts with source and version, task state and evidence, optional domain reference libraries. Never treat a model's summary as the source of truth for acceptance criteria, consent or legal/medical facts. Users can view, correct and delete memory. Separate private sources by project and role.

**Retrieval:** exact text, structured metadata, source registries, symbols where applicable, and semantic search where measured. Attach source URI/path, line/page/time range, retrieval date, jurisdiction/standard version, content hash and confidence. Stale or inaccessible sources are flagged. For astronomy, external ephemeris data such as JPL Horizons must be cited with query parameters and retrieval time [S1]. For law and medicine, secondary summaries cannot silently stand in for primary authorities.

**Budget:** maximum model calls, compute minutes, storage, output sizes, retry attempts and estimated spend per task. A budget exhaustion result includes the partial artifact and steps needed to continue, without marking completion.

## 12. Tool execution, privacy, safety and professional workflows

**Trust classes:** user/organization grants; kernel policy; pack manifests; untrusted project content; untrusted model output; untrusted tool/web results; external side effects. A prompt cannot authorize filesystem escape, network exfiltration or professional action. OS-enforced sandboxes or isolated workers are separately tested; child_process itself is not one.

**Permission classes:** read local, write local, execute, network read, network write, spend money, access sensitive data, act on an external account, publish, commit/push/deploy, clinical/legal/financial consequential action. Approval is scoped to operation/resource/time/budget. Deny rules dominate allow rules. A pack requests permissions through a manifest; the user sees them before installation or execution.

**High-stakes distinction:** brainstorming or education about medicine/law/accounting can be supported earlier with source checks and limitations. Patient-specific clinical decisions, legal representation/advice in a jurisdiction, financial filings or money movement require dedicated governance, relevant professional oversight, auditability, regional legal review and evaluation. The product must not present a generic model answer as a licensed professional judgment. NIST's AI RMF and generative AI profile offer cross-sector risk management guidance [N1][N2]; WHO, UNESCO and ABA provide domain-specific perspectives [H1][E1][L1].

**Creative rights:** record uploaded source ownership/permissions, licensed assets, generated asset provider terms, human contributions, likeness/voice consent and export attribution. Flag unresolved rights rather than declaring an asset safe to commercialize. C2PA can carry supported provenance but is not a legal determination [P1][P2].

**Identity of reviewers:** later professional packs require verified organization roles and accountable signoff. A JSON string naming “clinician” is not identity verification. The v0.3 validator only models the future contract.

## 13. Quality system by artifact

Every pack defines its own validation ladder and failure semantics. Shared statuses: PASS, FAIL, NOT_RUN, BLOCKED, NOT_APPLICABLE, HUMAN_REVIEW_REQUIRED. Evidence binds to artifact hash and criterion version.

- Software: focused tests, type/lint/build, real API/browser behavior, security/accessibility as relevant.
- Film: playable master, media metadata, continuity, sound sync, narrative and rights review.
- Game: import/open project, play mode, platform build, frame-time and user playtest.
- Education: objectives, accurate content, accessibility, assessment validity and educator review.
- Astronomy: dimensions/units, independent computation, parameter sources, uncertainty and reproducibility.
- Medicine/legal/accounting: verified sources/standards, qualified review, documented limitations and jurisdiction/context.
- Cross-domain: source format and assumptions validated at handoff; downstream changes invalidate dependent evidence.

Do not invent a single “99% quality” metric. Use task-specific acceptance evidence and human judgment where needed.

## 14. Evaluation, durability and observability

Create a benchmark corpus with authorized input projects, starting versions, expected outputs, verification scripts, rights constraints, budgets, and human rubrics. Include real self-hosted software defects, a coherent 90-second animation task, a playable game micro-scene, a lesson with assessment, an orbital calculation, and reviewed professional drafts. Separate automated pass/fail from subjective review. Cross-domain benchmark: reuse one character/world/fact across film, game, lesson and website without contradictions.

Measure artifact usability, criterion satisfaction, source correctness, human revisions, cost per accepted artifact, latency, crash recovery, stalled-task rate, rights omissions and rollback accuracy. Detect gaming: deleted tests, weaker assertions, fake renders, fabricated citations, invented reviewer signoff. Compare competitors only on matched tasks, models and budgets, with transparent limitations.

**Durability:** crash injection at each state transition, migration tests, content-hash integrity, backup/restore, resumable upload/render, bounded logs and storage quotas. Report p50/p95 stage time and failure classes. Default 8 GB local machine budgets are measured on fixtures; heavy jobs become optional remote execution.

**Operations:** structured logs with correlation IDs, opt-in telemetry, privacy-respecting diagnostics export, feature flags, staged releases and rollback, vulnerability response, supply-chain review. Do not collect user artifacts for training without a separate clear choice.

## 15. Build phases with exact gates

The product is developed in gates, not a single “build everything” prompt. Each phase includes design, implementation, tests, documentation, review and a reproducible demo. A feature is not complete because a UI button exists.

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| **F0 — Repo discipline** | Git, ADRs, strict TypeScript/pnpm workspace, CI, architecture tests, migration of v0.3 seed | Fresh Windows/Linux setup; all v0.3 behaviors retained; one lockfile; no empty packages |
| **F1 — Universal contracts** | Project/task/artifact/evidence schemas, pack manifest, local protocol, CLI | Film and software contracts validate through the same kernel; unsupported capabilities are visibly reported |
| **F2 — Durable kernel** | Event store, scheduler, budgets, cancel/resume, permissions, artifact store | Crash/restart and retry tests; no duplicate external action; artifact/evidence versions consistent |
| **F3 — Trust and model foundation** | One provider, read-only planning, source provenance, secret filtering, eval/security fixtures | No unauthorized file/tool action; cited plans with bounded budget and accurate failures |
| **S0 — Software pack extraction** | Move inspector/verifier into software pack; repository/workspace mapping | Multi-package fixture and dirty worktree handled; seed parity maintained |
| **S1 — VS Code experience** | Task intake, map, plan, progress, diff and evidence | User can inspect/verify Craft Agent and distinguish failed, skipped and timed-out checks |
| **S2 — Safe editing** | Patch preconditions, worktree, approvals, scoped restore | Conflict tests, unrelated edits survive, restore scope accurate |
| **S3 — Real software validation** | API/browser/log tools and self-hosted task loop | Fix a genuine defect in Craft Agent with before/after repro and accepted review |
| **S4 — Software beta** | OS sandbox, platform installers, benchmark and recovery | Cross-platform gates and repeated accepted tasks; honest known limits |
| **U1 — Artifact/pack SDK** | Document/table/media formats, rights metadata, writing/research pack | A custom pack imports/exports an editable artifact and passes compatibility tests |
| **U2 — Creative/education pilots** | Film script/storyboard/timeline preview, basic media adapter, lessons | A short playable rendered scene and a reviewed lesson meet their own criteria |
| **U3 — Game/astronomy pilots** | Game-engine and scientific-compute adapters, unit/source validation | A playable micro-game and reproducible orbital visualization pass independent review |
| **U4 — Cross-domain Studio** | Desktop project canvas, graph, asset reuse and handoff | One project moves approved assets/facts across three packs without losing provenance |
| **R1 — Health research/education** | Expert-designed limited workflows, source and privacy evaluation | Independent clinical-domain review; no autonomous consequential clinical use |
| **R2 — Legal/accounting pilots** | Jurisdiction/standard metadata, source checks, professional signoff | Qualified reviewers and applicable local requirements validated before consequential beta |
| **L1 — Optional cloud** | Isolated render/build/compute workers, tenant policy, billing budgets | Security review, repeatable recovery and consented cost/transfer; local mode still works |
| **L2 — Ecosystem/scale** | Pack marketplace, teams, API, broader languages, mobile/web clients | Signed/versioned packs, governance, independent evals and demonstrated demand |

**Critical path:** F0 -> F1 -> F2/F3 -> S0–S4. U1 begins after the universal contracts are stable and can overlap the later software beta; U2/U3 follow verified packs. R1/R2 are separate governance programs, not automatic next features. L1/L2 depend on measured use. Do not promise calendar dates for all phases; estimate each after its predecessor's measured outcomes.

### Immediate tickets

1. Preserve v0.3 behavior as contract fixtures; initialize Git and CI; define package export boundaries.
2. Write runtime schemas and compatibility tests for TaskContract, Artifact, Evidence and CapabilityPack.
3. Move current inspect/verify tools behind a real software pack interface without changing CLI behavior.
4. Implement a local event store and a one-step read-only task run with crash recovery.
5. Connect a basic VS Code view only after the protocol works headlessly.

Each ticket includes the failure case, permission effect, tests, migration and rollback. Review each phase before committing; do not add tool co-author attribution to commits. Do not commit, push or deploy until the owner explicitly authorizes that action.

## 16. Business and sustainability

The first release should be useful locally with user-chosen inference access. Offer a core that does not depend on a region-specific payment service unavailable to the owner. Heavy rendering and paid models may cost money; show estimated and actual usage where available. The eventual business can charge for managed compute, team governance or validated premium packs while keeping local project ownership and portability. Validate willingness to pay after people complete real tasks; avoid speculative pricing.

**Distribution:** start with a CLI and VS Code extension for software creators, then a desktop Studio for broader audiences. A Code – OSS fork adds a long maintenance and extension distribution burden; only consider it after a measured limitation [V1][V2].

## 17. Non-negotiable acceptance for public claims

Never call the platform “ideal for everyone,” “error-free,” “medical-grade,” “lawyer-level,” or “better than Cursor” without a precise, independently reviewable claim and evidence. Public capability lists must distinguish fully supported, beta, limited/needs-review and planned. The strongest future position comes from products that work reliably, disclose boundaries and learn from measured failures.

## 18. Source register

- [C1] [Cursor Agent](https://cursor.com/docs/agent/overview)
- [C2] [Cursor Tab completion](https://prod.cursor.com/help/ai-features/tab)
- [O1] [Codex CLI](https://developers.openai.com/codex/cli)
- [O2] [Codex sandboxing](https://developers.openai.com/codex/sandboxing)
- [A1] [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [A2] [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing)
- [M1] [Adobe Firefly](https://firefly.adobe.com/)
- [M2] [Canva Magic Design](https://www.canva.com/magic-design/)
- [G1] [Unity AI tools](https://unity.com/features/ai)
- [N1] [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [N2] [NIST Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [H1] [WHO guidance on large multimodal models in health](https://www.who.int/publications/i/item/9789240084759)
- [E1] [UNESCO guidance for generative AI in education](https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research)
- [L1] [ABA Formal Opinion 512 summary](https://www.americanbar.org/news/abanews/aba-news-archives/2024/07/aba-issues-first-ethics-guidance-ai-tools/)
- [P1] [C2PA specifications](https://spec.c2pa.org/specifications/specifications/2.3/)
- [P2] [US Copyright Office AI reports](https://www.copyright.gov/ai/)
- [S1] [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- [I1] [MCP 2026-07-28 revision](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [V1] [Code – OSS versus Visual Studio Code](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code)
- [V2] [VS Code Marketplace FAQ](https://code.visualstudio.com/docs/supporting/faq)

Recheck domain rules, model/provider terms and competitor features before implementing or marketing decisions that depend on them. The source register is design input, not a substitute for jurisdiction-specific professional review.
