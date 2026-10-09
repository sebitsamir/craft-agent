import { randomUUID } from 'node:crypto';
import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import type {
  ActionGuard,
  CompleteExternalActionInput,
  ExternalActionRecord,
  ExternalActionReservation,
  FailExternalActionInput,
  ReserveExternalActionInput,
} from '@junub-agent/kernel';
import type { JunubDatabase } from './database.js';

/**
 * SQLite implementation of the kernel ActionGuard port.
 *
 * This is the core guard against duplicate external side effects.
 *
 * Correct caller pattern:
 * 1. reserveExternalAction(idempotencyKey)
 * 2. If alreadyExisted, do not execute again; reconcile/return stored result.
 * 3. If newly reserved, execute the external action.
 * 4. completeExternalAction or failExternalAction.
 */

/**
 * Raw SQLite row for external_actions.
 */
interface ExternalActionRow {
  execution_id: string;
  task_id: string;
  step_id: string | null;
  idempotency_key: string;
  status: 'reserved' | 'completed' | 'failed';
  result_json: string | null;
  error_json: string | null;
  reserved_at: string;
  completed_at: string | null;
}

export class SqliteActionGuard implements ActionGuard {
  private readonly db: JunubDatabase;

  constructor(db: JunubDatabase) {
    this.db = db;
  }

  /**
   * Reserves an external action before executing it.
   */
  async reserveExternalAction(
    input: ReserveExternalActionInput,
  ): Promise<ExternalActionReservation> {
    const taskId = requireNonemptyString(input.taskId, 'taskId');
    const idempotencyKey = requireNonemptyString(input.idempotencyKey, 'idempotencyKey');

    const reserveTransaction = this.db.transaction((): ExternalActionReservation => {
      // Check whether this idempotency key was already used.
      const existing = this.db
        .prepare('SELECT * FROM external_actions WHERE idempotency_key = ?')
        .get(idempotencyKey) as ExternalActionRow | undefined;

      if (existing) {
        // Duplicate reservation is not an error here.
        // The caller must treat this as "do not execute again".
        return {
          ...rowToRecord(existing),
          alreadyExisted: true,
        };
      }

      // Create a new reserved execution record.
      const executionId = randomUUID();
      const reservedAt = new Date().toISOString();

      this.db
        .prepare(
          `
            INSERT INTO external_actions (
              execution_id,
              task_id,
              step_id,
              idempotency_key,
              status,
              reserved_at
            )
            VALUES (?, ?, ?, ?, 'reserved', ?);
          `,
        )
        .run(
          executionId,
          taskId,
          input.stepId ?? null,
          idempotencyKey,
          reservedAt,
        );

      return {
        executionId,
        taskId,
        stepId: input.stepId,
        idempotencyKey,
        status: 'reserved',
        reservedAt,
        alreadyExisted: false,
      };
    });

    return reserveTransaction();
  }

  /**
   * Completes a reserved external action.
   */
  async completeExternalAction(
    input: CompleteExternalActionInput,
  ): Promise<ExternalActionRecord> {
    const idempotencyKey = requireNonemptyString(input.idempotencyKey, 'idempotencyKey');

    const completeTransaction = this.db.transaction((): ExternalActionRecord => {
      const existing = this.db
        .prepare('SELECT * FROM external_actions WHERE idempotency_key = ?')
        .get(idempotencyKey) as ExternalActionRow | undefined;

      if (!existing) {
        throw new JunubError(
          JunubErrorCode.EXTERNAL_ACTION_CONFLICT,
          `Cannot complete external action because no reservation exists for idempotency key "${idempotencyKey}".`,
          { idempotencyKey },
        );
      }

      // Idempotent completion: if already completed, return stored record.
      if (existing.status === 'completed') {
        return rowToRecord(existing);
      }

      // Completing a failed action is a conflict and requires inspection.
      if (existing.status === 'failed') {
        throw new JunubError(
          JunubErrorCode.EXTERNAL_ACTION_CONFLICT,
          `Cannot complete external action "${idempotencyKey}" because it was already marked failed.`,
          { idempotencyKey },
        );
      }

      const completedAt = new Date().toISOString();
      const resultJson = JSON.stringify(input.result ?? null);

      this.db
        .prepare(
          `
            UPDATE external_actions
            SET status = 'completed',
                result_json = ?,
                completed_at = ?
            WHERE idempotency_key = ? AND status = 'reserved';
          `,
        )
        .run(resultJson, completedAt, idempotencyKey);

      return {
        ...rowToRecord(existing),
        status: 'completed',
        result: input.result,
        completedAt,
      };
    });

    return completeTransaction();
  }

  /**
   * Marks a reserved external action as failed.
   */
  async failExternalAction(input: FailExternalActionInput): Promise<ExternalActionRecord> {
    const idempotencyKey = requireNonemptyString(input.idempotencyKey, 'idempotencyKey');

    const failTransaction = this.db.transaction((): ExternalActionRecord => {
      const existing = this.db
        .prepare('SELECT * FROM external_actions WHERE idempotency_key = ?')
        .get(idempotencyKey) as ExternalActionRow | undefined;

      if (!existing) {
        throw new JunubError(
          JunubErrorCode.EXTERNAL_ACTION_CONFLICT,
          `Cannot fail external action because no reservation exists for idempotency key "${idempotencyKey}".`,
          { idempotencyKey },
        );
      }

      // Idempotent failure: if already failed, return stored record.
      if (existing.status === 'failed') {
        return rowToRecord(existing);
      }

      // Failing a completed action is a conflict and requires inspection.
      if (existing.status === 'completed') {
        throw new JunubError(
          JunubErrorCode.EXTERNAL_ACTION_CONFLICT,
          `Cannot fail external action "${idempotencyKey}" because it was already completed.`,
          { idempotencyKey },
        );
      }

      const completedAt = new Date().toISOString();
      const errorJson = JSON.stringify(input.error ?? null);

      this.db
        .prepare(
          `
            UPDATE external_actions
            SET status = 'failed',
                error_json = ?,
                completed_at = ?
            WHERE idempotency_key = ? AND status = 'reserved';
          `,
        )
        .run(errorJson, completedAt, idempotencyKey);

      return {
        ...rowToRecord(existing),
        status: 'failed',
        error: input.error,
        completedAt,
      };
    });

    return failTransaction();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a SQLite row to the kernel ExternalActionRecord shape.
 */
function rowToRecord(row: ExternalActionRow): ExternalActionRecord {
  return {
    executionId: row.execution_id,
    taskId: row.task_id,
    stepId: row.step_id ?? undefined,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    result: parseJson(row.result_json),
    error: parseJson(row.error_json),
    reservedAt: row.reserved_at,
    completedAt: row.completed_at ?? undefined,
  };
}

/**
 * Parses JSON safely for nullable SQLite TEXT fields.
 */
function parseJson(value: string | null): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    // Corrupt JSON in storage is a serious issue, but for F2 Slice 1 we
    // surface the raw string instead of crashing recovery.
    return value;
  }
}

/**
 * Validates that a value is a nonempty string.
 */
function requireNonemptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new JunubError(
      JunubErrorCode.EXTERNAL_ACTION_CONFLICT,
      `${field} must be a nonempty string.`,
      { field },
    );
  }

  return value;
}
