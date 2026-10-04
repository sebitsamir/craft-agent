import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  EventStore,
  StoredTaskEvent,
  AppendTaskEventRequest,
} from '../port/event-store.js';

/**
 * A durable, dependency-free EventStore backed by a JSONL append-only file.
 *
 * Implements the same EventStore port as the SQLite adapter, so it is
 * swappable. Because events are appended to disk, task progress survives
 * process crashes and can be replayed on restart.
 */
export class FileEventStore implements EventStore {
  constructor(private readonly filePath: string) {}

  async appendTaskEvent(request: AppendTaskEventRequest): Promise<StoredTaskEvent> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const events = await this.listTaskEvents(request.taskId);

    // Idempotency: never append a duplicate for the same taskId + key.
    const existing = events.find(
      (e) => e.idempotencyKey && e.idempotencyKey === request.idempotencyKey,
    );
    if (existing) return existing;

    const stored: StoredTaskEvent = {
      taskId: request.taskId,
      sequence: events.length + 1,
      eventId: request.eventId,
      type: request.type,
      payload: request.payload ?? {},
      idempotencyKey: request.idempotencyKey,
      occurredAt: request.occurredAt ?? new Date().toISOString(),
      recordedAt: new Date().toISOString(),
    };

    await appendFile(this.filePath, JSON.stringify(stored) + '\n', 'utf8');
    return stored;
  }

  async listTaskEvents(taskId: string): Promise<StoredTaskEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredTaskEvent)
      .filter((e) => e.taskId === taskId);
  }

  async close(): Promise<void> {
    // Nothing to release for a file-backed store.
  }
}