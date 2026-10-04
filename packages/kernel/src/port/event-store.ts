/**
 * Event store port.
 *
 * The kernel depends on this interface, not on SQLite.
 * A local SQLite adapter implements it in @junub-agent/storage.
 * A future cloud adapter can implement the same interface.
 */

/**
 * A durable task event after it has been stored.
 *
 * The sequence is assigned by the store and is monotonically increasing
 * per task, starting at 1.
 */
export interface StoredTaskEvent {
  readonly taskId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly payload: unknown;

  /**
   * Optional idempotency key.
   * If present, the store must not append a second event with the same
   * taskId + idempotencyKey combination.
   */
  readonly idempotencyKey?: string;

  readonly occurredAt: string;
  readonly recordedAt: string;
}

/**
 * Request to append one task event.
 */
export interface AppendTaskEventRequest {
  readonly taskId: string;
  readonly eventId: string;
  readonly type: string;
  readonly payload?: unknown;

  /**
   * Optional idempotency key for safe retries and crash recovery.
   */
  readonly idempotencyKey?: string;

  /**
   * Optional occurred timestamp. If omitted, the store assigns current time.
   */
  readonly occurredAt?: string;
}

/**
 * Durable event log abstraction.
 */
export interface EventStore {
  /**
   * Appends an event atomically.
   *
   * If an idempotencyKey is supplied and an event with the same
   * taskId + idempotencyKey already exists, the existing event is returned
   * instead of appending a duplicate.
   */
  appendTaskEvent(request: AppendTaskEventRequest): Promise<StoredTaskEvent>;

  /**
   * Lists events for one task in ascending sequence order.
   */
  listTaskEvents(taskId: string, afterSequence?: number): Promise<StoredTaskEvent[]>;

  /**
   * Closes underlying storage.
   */
  close(): Promise<void>;
}
