import { randomUUID } from 'node:crypto';
import { CraftError, CraftErrorCode } from '@craft-agent/contracts';
import type {
  AppendTaskEventRequest,
  EventStore,
  StoredTaskEvent,
} from '@craft-agent/kernel';
import type { CraftDatabase } from './database.js';
/**
 * SQLite implementation of the kernel EventStore port.
 *
 * Guarantees:
 * - One event log per task.
 * - Monotonic sequence numbers per task.
 * - Idempotent appends when idempotencyKey is provided.
 * - Atomic append transactions.
 */

/**
 * Raw row shape returned by SQLite.
 */
interface TaskEventRow {
  event_id: string;
  task_id: string;
  sequence: number;
  type: string;
  payload_json: string;
  idempotency_key: string | null;
  occurred_at: string;
  recorded_at: string;
}

export class SqliteEventStore implements EventStore {
  private readonly db: CraftDatabase;

  constructor(db: CraftDatabase) {
    this.db = db;
  }

  /**
   * Appends one task event atomically.
   */
  async appendTaskEvent(request: AppendTaskEventRequest): Promise<StoredTaskEvent> {
    // Validate request envelope before touching SQLite.
    const taskId = requireNonemptyString(request.taskId, 'taskId');
    const eventId = requireNonemptyString(request.eventId, 'eventId');
    const type = requireNonemptyString(request.type, 'type');

    // Empty idempotency keys are invalid because they would break uniqueness logic.
    if (request.idempotencyKey !== undefined && request.idempotencyKey.trim().length === 0) {
      throw new CraftError(
        CraftErrorCode.EVENT_MALFORMED,
        'idempotencyKey must be a nonempty string when present.',
      );
    }

    // All appends happen inside one SQLite transaction.
    const appendTransaction = this.db.transaction(
      (input: AppendTaskEventRequest): StoredTaskEvent => {
        // -------------------------------------------------------------------
        // 1. Idempotency check.
        // If this task already recorded an event with the same idempotency key,
        // return the existing event instead of appending a duplicate.
        // -------------------------------------------------------------------
        if (input.idempotencyKey !== undefined) {
          const existingByIdempotency = this.db
            .prepare(
              `
                SELECT *
                FROM task_events
                WHERE task_id = ? AND idempotency_key = ?
              `,
            )
            .get(taskId, input.idempotencyKey) as TaskEventRow | undefined;

          if (existingByIdempotency) {
            return rowToEvent(existingByIdempotency);
          }
        }

        // -------------------------------------------------------------------
        // 2. Event id idempotency/conflict check.
        // The same eventId may be resent after a crash.
        // If it matches the same logical event, return it.
        // If it conflicts, fail explicitly.
        // -------------------------------------------------------------------
        const existingByEventId = this.db
          .prepare(
            `
              SELECT *
              FROM task_events
              WHERE event_id = ?
            `,
          )
          .get(eventId) as TaskEventRow | undefined;

        if (existingByEventId) {
          const sameTask = existingByEventId.task_id === taskId;
          const sameType = existingByEventId.type === type;
          const sameIdempotency =
            (existingByEventId.idempotency_key ?? undefined) === input.idempotencyKey;

          if (sameTask && sameType && sameIdempotency) {
            return rowToEvent(existingByEventId);
          }

          throw new CraftError(
            CraftErrorCode.EVENT_MALFORMED,
            `eventId "${eventId}" already exists with different attributes.`,
            {
              eventId,
              taskId,
              type,
            },
          );
        }

        // -------------------------------------------------------------------
        // 3. Assign the next monotonic sequence number for this task.
        // -------------------------------------------------------------------
        const nextSequenceRow = this.db
          .prepare(
            `
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM task_events
              WHERE task_id = ?
            `,
          )
          .get(taskId) as { next_sequence: number };

        const sequence = nextSequenceRow.next_sequence;

        // -------------------------------------------------------------------
        // 4. Insert the event.
        // -------------------------------------------------------------------
        const occurredAt = input.occurredAt ?? new Date().toISOString();
        const recordedAt = new Date().toISOString();
        const payloadJson = JSON.stringify(input.payload ?? {});

        this.db
          .prepare(
            `
              INSERT INTO task_events (
                event_id,
                task_id,
                sequence,
                type,
                payload_json,
                idempotency_key,
                occurred_at,
                recorded_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            `,
          )
          .run(
            eventId,
            taskId,
            sequence,
            type,
            payloadJson,
            input.idempotencyKey ?? null,
            occurredAt,
            recordedAt,
          );

        return {
          taskId,
          sequence,
          eventId,
          type,
          payload: JSON.parse(payloadJson),
          idempotencyKey: input.idempotencyKey,
          occurredAt,
          recordedAt,
        };
      },
    );

    return appendTransaction(request);
  }

  /**
   * Lists task events in ascending sequence order.
   */
  async listTaskEvents(
    taskId: string,
    afterSequence = 0,
  ): Promise<StoredTaskEvent[]> {
    requireNonemptyString(taskId, 'taskId');

    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM task_events
          WHERE task_id = ? AND sequence > ?
          ORDER BY sequence ASC
        `,
      )
      .all(taskId, afterSequence) as TaskEventRow[];

    return rows.map((row) => rowToEvent(row));
  }

  /**
   * Closes the SQLite database.
   */
  async close(): Promise<void> {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a SQLite row into the kernel StoredTaskEvent shape.
 */
function rowToEvent(row: TaskEventRow): StoredTaskEvent {
  return {
    taskId: row.task_id,
    sequence: row.sequence,
    eventId: row.event_id,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    idempotencyKey: row.idempotency_key ?? undefined,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}

/**
 * Validates that a value is a nonempty string.
 */
function requireNonemptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CraftError(
      CraftErrorCode.EVENT_MALFORMED,
      `${field} must be a nonempty string.`,
      { field },
    );
  }

  return value;
}
