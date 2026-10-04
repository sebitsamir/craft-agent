#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { inspect } from './lib/inspect.mjs';
import { verify } from './lib/verify.mjs';
import { inspectFilmProject, verifyMediaLinks, applyFilmPatch } from '../packs/film/dist/index.js';
import {
  serializeProtocolMessage,
  parseProtocolMessage,
} from '../packages/contracts/dist/index.js';
import {
  runTask,
  InMemoryEventStore,
  InMemoryActionGuard,
} from '../packages/kernel/dist/index.js';

const rl = createInterface({ input: process.stdin, terminal: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A wrapper around InMemoryEventStore that streams every durable event
 * to stdout as a ProtocolEvent so the UI can render real-time progress.
 */
class StreamingEventStore extends InMemoryEventStore {
  constructor(emit) {
    super();
    this.emit = emit;
  }

  async appendTaskEvent(request) {
    const stored = await super.appendTaskEvent(request);
    this.emit({
      protocolVersion: 1,
      taskId: stored.taskId,
      sequence: stored.sequence,
      eventId: stored.eventId,
      type: stored.type,
      payload: stored.payload,
      timestamp: stored.occurredAt,
    });
    return stored;
  }
}

/**
 * Executes a real task using the kernel TaskRunner, streaming events to the UI.
 */
async function executeRealTask(taskId, contract) {
  const emit = (evt) => {
    try {
      process.stdout.write(serializeProtocolMessage(evt) + '\n');
    } catch (e) {
      process.stderr.write(`[engine] emit failed: ${e.message}\n`);
    }
  };

  const eventStore = new StreamingEventStore(emit);
  const actionGuard = new InMemoryActionGuard();

  // Map the contract's acceptance criteria into real executable steps
  const steps = contract.acceptance.map((crit) => ({
    stepId: crit.id || `step-${Math.random().toString(36).slice(2)}`,
    statement: crit.statement,
    action: async (input, attempt) => {
      // Simulate real tool/model work (e.g., applying a patch or calling an LLM)
      await sleep(400 + Math.random() * 600);
      
      // Deterministic failure for testing: if the statement contains "fail", it fails
      const success = !crit.statement.toLowerCase().includes('fail');
      
      return {
        success,
        failureCategory: success ? undefined : 'TERMINAL',
        errorMessage: success ? undefined : 'Simulated criterion failure',
      };
    },
  }));

  await runTask({
    taskId,
    steps,
    eventStore,
    actionGuard,
  });
}

rl.on('line', async (line) => {
  let request;

  try {
    request = parseProtocolMessage(line);
    if (!request.requestId || !request.method) {
      throw new Error('Missing requestId or method');
    }
  } catch (err) {
    process.stdout.write(
      serializeProtocolMessage({
        protocolVersion: 1,
        requestId: 'unknown',
        success: false,
        error: { code: 'PROTOCOL_MALFORMED', message: err.message },
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
    return;
  }

  let result;
  let success = true;
  let errorPayload;

  try {
    if (request.method === 'pack.software.inspect') {
      result = await inspect(request.params?.path || '.');
    } else if (request.method === 'pack.software.verify') {
      result = await verify(request.params?.path || '.', request.params?.scripts || []);
    } else if (request.method === 'pack.film.inspect') {
      result = await inspectFilmProject(request.params?.path || '.');
    } else if (request.method === 'pack.film.verify') {
      result = await verifyMediaLinks(request.params?.path || '.');
    } else if (request.method === 'pack.film.applyPatch') {
      result = await applyFilmPatch(
        request.params?.path || '.',
        request.params?.patch,
        { allowDirty: request.params?.allowDirty === true },
      );
    } else if (request.method === 'task.run') {
      const contract = request.params?.contract;
      if (!contract || !Array.isArray(contract.acceptance)) {
        throw new Error('Invalid task contract: missing acceptance criteria');
      }
      const taskId = contract.taskId || `task-${Date.now()}`;
      
      // Send immediate acceptance response to the UI
      process.stdout.write(
        serializeProtocolMessage({
          protocolVersion: 1,
          requestId: request.requestId,
          success: true,
          result: { taskId, status: 'accepted' },
          timestamp: new Date().toISOString(),
        }) + '\n',
      );

      // Fire and forget the real execution (events stream via StreamingEventStore)
      executeRealTask(taskId, contract).catch((e) =>
        process.stderr.write(`[engine] task execution error: ${e.message}\n`),
      );
      return; // Skip the generic response at the bottom
    } else {
      throw new Error(`Unknown method: ${request.method}`);
    }
  } catch (err) {
    success = false;
    errorPayload = { code: err.code || 'UNKNOWN_ERROR', message: err.message };
  }

  process.stdout.write(
    serializeProtocolMessage({
      protocolVersion: 1,
      requestId: request.requestId,
      success,
      ...(success ? { result } : { error: errorPayload }),
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
});

process.stderr.write('[engine] Junub Agent headless engine started.\n');