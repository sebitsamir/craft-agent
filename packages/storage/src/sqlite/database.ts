import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CraftError, CraftErrorCode } from '@craft-agent/contracts';

/**
 * Opens the Craft Agent local SQLite database.
 *
 * Design rules:
 * - WAL mode improves read concurrency and crash durability.
 * - synchronous=NORMAL is a common safe setting for WAL local apps.
 * - foreign_keys are enforced.
 * - migrations run inside transactions.
 */

/**
 * Concrete SQLite database handle type.
 *
 * Exporting this type fixes TS4058 ("cannot be named") during declaration
 * emit, and lets other storage modules reference the handle cleanly.
 */
export type CraftDatabase = InstanceType<typeof Database>;

/**
 * Opens the Craft Agent local SQLite database.
 */
export function openCraftDatabase(databaseFile: string): CraftDatabase {
  // Ensure the parent directory exists before opening the SQLite file.
  mkdirSync(path.dirname(databaseFile), { recursive: true });

  // Create/open the SQLite database file.
  const db = new Database(databaseFile);

  // Configure SQLite for local-first durability and reasonable performance.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Apply schema migrations.
  runMigrations(db);

  return db;
}

/**
 * Migration registry.
 *
 * Each migration must be idempotent and transactional.
 * Never edit an applied migration; add a new one instead.
 */
const MIGRATION_001_F2_FOUNDATION = `
-- -------------------------------------------------------------------------
-- Durable task event log.
-- The event log is authoritative for task/step recovery.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

-- Sequence must be monotonic and unique per task.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_task_sequence
ON task_events(task_id, sequence);

-- Idempotency keys prevent duplicate event appends during retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_task_idempotency
ON task_events(task_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- -------------------------------------------------------------------------
-- External action executions.
-- This table enforces "no duplicate external action" via idempotency keys.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_actions (
  execution_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('reserved', 'completed', 'failed')),
  result_json TEXT,
  error_json TEXT,
  reserved_at TEXT NOT NULL,
  completed_at TEXT
);

-- -------------------------------------------------------------------------
-- Artifact metadata.
-- Blob bytes are stored in the content-addressed artifact blob store.
-- These tables store version metadata and latest-version pointers.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  latest_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  state TEXT NOT NULL DEFAULT 'created',
  storage_path TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_sha256
ON artifact_versions(sha256);
`;

/**
 * Applies all pending migrations.
 */
function runMigrations(db: CraftDatabase): void {
  // Migration tracking table.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  // Read already-applied migration ids.
  const rows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{
    id: number;
  }>;

  const applied = new Set<number>(rows.map((row) => row.id));

  // Migration 001: F2 foundation schema.
  if (!applied.has(1)) {
    const applyMigration = db.transaction(() => {
      db.exec(MIGRATION_001_F2_FOUNDATION);

      db.prepare(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?);',
      ).run(1, '001_f2_foundation', new Date().toISOString());
    });

    try {
      applyMigration();
    } catch (error) {
      throw new CraftError(
        CraftErrorCode.STORAGE_MIGRATION_FAILED,
        `Failed to apply SQLite migration 001_f2_foundation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
