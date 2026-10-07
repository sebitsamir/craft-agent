# Junub Agent — universal creator seed

Junub Agent is a provisional name for a future multi-domain creation platform. The [master specification](PRODUCT_BLUEPRINT.md) defines its project/task/artifact/evidence kernel, software-first delivery, capability packs for film, games, education, astronomy and other fields, safety boundaries, full target folder structure, and phased gates. The [master implementation prompt](MASTER_PROMPT.md) is a reusable handoff for subsequent engineering sessions. The [phase ledger](PHASE_LEDGER.md) separates verified work from plans.

**Current status: v0.3 seed.** The CLI inspects a software repository, runs selected declared npm scripts, lists domain metadata, and validates task contracts. It does not yet use an AI model, edit code, render media, provide a UI, or perform professional-domain work. Planned domains are marked planned.

## Requirements

Node.js 20 or newer, npm, and optionally Git. The seed has no external package dependencies.

## Run

~~~bash
cd junub-agent
npm test
npm run check
node src/cli.mjs inspect .
node src/cli.mjs verify .
node src/cli.mjs domains
node src/cli.mjs validate-task examples/film-task.json
node src/cli.mjs validate-task examples/astronomy-task.json
node src/cli.mjs inspect /path/to/project --out report.json
node src/cli.mjs verify /path/to/project --scripts lint,test,build --out checks.json
~~~

The task examples are **contracts and evidence plans**, not generated artifacts. Validation requires outputs and testable acceptance criteria. High-impact tasks require a named reviewer role in the contract, but this does not verify the person's qualifications or the task's real-world risk.

By default, verify runs only declared check and test scripts. Other scripts require --scripts. Project scripts can execute arbitrary code; run them only in repositories you trust. Exit code 0 means successful command/valid task, 1 means failed check/invalid task, and 2 means invalid CLI input or a tool error.

## Current implementation

- Bounded source/test inventory with unreadable-directory warnings and symlink exclusion.
- Root package manifest inspection with explicit parse errors and Git worktree status.
- Declared script execution with separate bounded stdout/stderr and status categories.
- Domain metadata and domain-neutral task contract validation.
- Nine focused tests including Git renames, timeout, CLI parsing and task contracts.

## Next engineering gate

Preserve this CLI as a fixture while creating strict TypeScript contracts, a capability-pack interface, and a durable task/evidence kernel. The product plan's F0/F1 gates are the immediate work. Do not present the planned domain metadata as working capabilities.
