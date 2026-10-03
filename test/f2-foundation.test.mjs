import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Import built packages from dist.
// This avoids needing TypeScript support in the Node test runner.
import {
  openCraftDatabase,
  SqliteEventStore,
  SqliteActionGuard,
  SqliteArtifactRepository,
} from '../packages/storage/dist/index.js';

import { FsBlobStore } from '../packages/artifacts/dist/index.js';

import {
  createTaskRun,
  applyTaskEvent,
  TASK_EVENT_TYPES,
} from '../packages/kernel/dist/index.js';

import { validateEvidenceBinding } from '../packages/contracts/dist/index.js';

/**
 * F2 Slice 1 foundation tests.
 *
 * These tests prove:
 * - Event log durability and replay after close/reopen.
 * - Idempotent event append.
 * - No duplicate external action through the action guard.
 * - Content-addressed artifact blob consistency.
 * - Evidence can bind to exact artifact version/hash.
 */

let tempDir;
let db;
let eventStore;
let actionGuard;
let artifactRepo;
let blobStore;

before(async () => {
  // Create isolated temporary storage for this test run.
  tempDir = await mkdtemp(path.join(tmpdir(), 'craft-f2-'));

  const databaseFile = path.join(tempDir, 'craft.sqlite');
  const blobDir = path.join(tempDir, 'blobs');

  // Open SQLite and instantiate adapters.
  db = openCraftDatabase(databaseFile);
  eventStore = new SqliteEventStore(db);
  actionGuard = new SqliteActionGuard(db);
  artifactRepo = new SqliteArtifactRepository(db);

  // Blob store verifies reads in tests.
  blobStore = new FsBlobStore(blobDir, { verifyOnRead: true });
});

after(async () => {
  // Close storage before deleting temp files.
  if (eventStore) {
    await eventStore.close();
  }

  // Clean up temporary storage.
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('event store supports durable replay after close/reopen', async () => {
  const taskId = 'task-f2-lifecycle';

  // Append a simple one-step task lifecycle.
  await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-life-1',
    type: TASK_EVENT_TYPES.taskCreated,
    payload: {},
  });

  await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-life-2',
    type: TASK_EVENT_TYPES.taskStarted,
    payload: {},
  });

  await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-life-3',
    type: TASK_EVENT_TYPES.stepQueued,
    payload: { stepId: 'step-1' },
  });

  await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-life-4',
    type: TASK_EVENT_TYPES.stepStarted,
    payload: { stepId: 'step-1' },
  });

  await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-life-5',
    type: TASK_EVENT_TYPES.stepSucceeded,
    payload: { stepId: 'step-1' },
  });

  await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-life-6',
    type: TASK_EVENT_TYPES.taskSucceeded,
    payload: {},
  });

  // Close and reopen the database to simulate process restart.
  await eventStore.close();

  const databaseFile = path.join(tempDir, 'craft.sqlite');
  db = openCraftDatabase(databaseFile);
  eventStore = new SqliteEventStore(db);
  actionGuard = new SqliteActionGuard(db);
  artifactRepo = new SqliteArtifactRepository(db);

  // Replay all events for the task.
  const events = await eventStore.listTaskEvents(taskId);

  let state = createTaskRun(taskId);

  for (const event of events) {
    state = applyTaskEvent(state, event);
  }

  // The recovered state must show the task succeeded.
  assert.equal(state.status, 'succeeded');
  assert.equal(state.lastSequence, 6);

  const step = state.steps.get('step-1');
  assert.ok(step, 'step-1 should exist after replay');
  assert.equal(step.status, 'succeeded');
  assert.equal(step.attempts, 1);
});

test('event store appends idempotently for the same idempotency key', async () => {
  const taskId = 'task-f2-idempotency';

  const first = await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-idem-1',
    type: TASK_EVENT_TYPES.taskBlocked,
    payload: { reason: 'waiting-for-input' },
    idempotencyKey: 'block-waiting-for-input',
  });

  const second = await eventStore.appendTaskEvent({
    taskId,
    eventId: 'evt-idem-1',
    type: TASK_EVENT_TYPES.taskBlocked,
    payload: { reason: 'waiting-for-input' },
    idempotencyKey: 'block-waiting-for-input',
  });

  // Both calls must return the same stored sequence.
  assert.equal(first.sequence, second.sequence);

  // The log must contain only one event with that idempotency key.
  const events = await eventStore.listTaskEvents(taskId);
  const matching = events.filter(
    (event) => event.idempotencyKey === 'block-waiting-for-input',
  );

  assert.equal(matching.length, 1);
});

test('action guard prevents duplicate external action execution', async () => {
  const taskId = 'task-f2-action';
  const idempotencyKey = 'external-action-1';

  // This counter represents a real external side effect.
  let externalExecutions = 0;

  async function performExternalAction() {
    // Always reserve before executing.
    const reservation = await actionGuard.reserveExternalAction({
      taskId,
      stepId: 'step-action',
      idempotencyKey,
    });

    // If the reservation already existed, do not execute again.
    if (reservation.alreadyExisted) {
      return reservation;
    }

    // Execute the external side effect exactly once.
    externalExecutions += 1;

    // Complete the action with a bounded result payload.
    return actionGuard.completeExternalAction({
      idempotencyKey,
      result: { ok: true, output: 'external-result' },
    });
  }

  // Call the same logical action twice.
  await performExternalAction();
  await performExternalAction();

  // The external side effect must have happened only once.
  assert.equal(externalExecutions, 1);
});

test('blob store and artifact repository keep hash-bound versions consistent', async () => {
  const artifactId = 'artifact-f2-1';
  const content = new TextEncoder().encode('# Craft Agent F2 artifact\n');

  // Write blob bytes into content-addressed storage.
  const blob = await blobStore.writeBytes(content);

  // Create artifact metadata.
  await artifactRepo.createArtifact({
    artifactId,
    kind: 'document',
    format: 'markdown',
  });

  // Add artifact version metadata bound to the blob hash.
  const version = await artifactRepo.addArtifactVersion({
    artifactId,
    sha256: blob.sha256,
    sizeBytes: blob.sizeBytes,
    storagePath: blob.path,
    state: 'created',
  });

  // The version hash must match the blob hash.
  assert.equal(version.hash, blob.sha256);

  // Reading with verification must return the exact bytes.
  const readBytes = await blobStore.readBytes(version.hash, { verify: true });
  assert.deepEqual(new Uint8Array(readBytes), content);

  // Build a minimal task contract for evidence binding.
  const task = {
    schemaVersion: 1,
    taskId: 'task-f2-artifact',
    title: 'Artifact consistency task',
    intent: 'Prove artifact/evidence hash binding works.',
    domain: 'software',
    impact: 'low',
    outputs: [
      {
        kind: 'document',
        format: 'markdown',
        description: 'F2 artifact document.',
      },
    ],
    acceptance: [
      {
        id: 'criterion-artifact',
        statement: 'The artifact bytes must match the stored hash.',
        evidence: {
          method: 'source_check',
          description: 'Read blob and verify SHA-256.',
        },
      },
    ],
  };

  // Build an evidence record bound to the exact artifact version.
  const evidence = {
    id: 'evidence-f2-1',
    criterionId: 'criterion-artifact',
    artifactId: version.artifactId,
    artifactVersion: version.version,
    contentHash: version.hash,
    method: 'source_check',
    status: 'pass',
    description: 'Blob read and hash verification succeeded.',
    recordedAt: new Date().toISOString(),
  };

  // Evidence binding must pass because criterion/artifact/version/hash match.
  assert.doesNotThrow(() => {
    validateEvidenceBinding(evidence, task, version);
  });
});
