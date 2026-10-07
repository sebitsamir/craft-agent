#!/usr/bin/env node
import { createInterface } from 'node:readline';
import path from 'node:path';

// Domain packs
import { inspect } from './lib/inspect.mjs';
import { verify } from './lib/verify.mjs';
import { inspectFilmProject, verifyMediaLinks, applyFilmPatch } from '../packs/film/dist/index.js';

// Protocol & Contracts
import {
  serializeProtocolMessage,
  parseProtocolMessage,
} from '../packages/contracts/dist/index.js';

// Kernel Execution
import {
  runTask,
  InMemoryActionGuard,
  FileEventStore,
} from '../packages/kernel/dist/index.js';
import { makeStepAction } from './lib/actions.mjs';

// Models (Planning & Routing)
import {
  CapabilityRouter,
  generateReadOnlyPlan,
  compilePlan,
} from '../packages/models/dist/index.js';
import { selectModelProvider } from './lib/providers.mjs';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, terminal: false });
const TASK_LOG_DIR = process.env.JUNUB_TASK_LOG_DIR || path.join('.junub', 'tasks');

class StreamingEventStore extends FileEventStore {
  constructor(filePath, emit) {
    super(filePath);
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

async function executeRealTask(taskId, contract, plan) {
  const emit = (evt) => {
    try {
      process.stdout.write(serializeProtocolMessage(evt) + '\n');
    } catch (e) {
      process.stderr.write(`[engine] emit failed: ${e.message}\n`);
    }
  };

  const filePath = path.join(TASK_LOG_DIR, `${taskId}.jsonl`);
  const eventStore = new StreamingEventStore(filePath, emit);
  const actionGuard = new InMemoryActionGuard();

  const plannedSteps = Array.isArray(plan)
    ? plan
    : contract.acceptance.map((c) => ({
      stepId: c.id,
      statement: c.statement,
      action: { kind: 'noop', params: { statement: c.statement } },
    }));

  const steps = plannedSteps.map((s) => ({
    stepId: s.stepId || s.id || `step-${Math.random().toString(36).slice(2)}`,
    statement: s.statement || s.stepId || s.id,
    action: makeStepAction(s.action),
  }));

  await runTask({ taskId, steps, eventStore, actionGuard });
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
    } else if (request.method === 'task.plan') {
      const contract = request.params?.contract;
      if (!contract || !Array.isArray(contract.acceptance)) {
        throw new Error('Invalid task contract: missing acceptance criteria');
      }
      const { provider, source } = selectModelProvider();
      process.stderr.write(`[engine] task.plan using provider: ${source}\n`);
      const router = new CapabilityRouter([provider]);
      await router.refreshModels();
      result = await generateReadOnlyPlan(contract, { router });
    } else if (request.method === 'task.compile') {
      const plan = request.params?.plan;
      const context = request.params?.context;
      if (!plan || !context) {
        throw new Error('Missing plan or context for compilation');
      }
      result = compilePlan(plan, context);
    } else if (request.method === 'task.run') {
      const contract = request.params?.contract;
      if (!contract || !Array.isArray(contract.acceptance)) {
        throw new Error('Invalid task contract: missing acceptance criteria');
      }
      const taskId = contract.taskId || `task-${Date.now()}`;

      process.stdout.write(
        serializeProtocolMessage({
          protocolVersion: 1,
          requestId: request.requestId,
          success: true,
          result: { taskId, status: 'accepted' },
          timestamp: new Date().toISOString(),
        }) + '\n',
      );

      executeRealTask(taskId, contract, request.params?.plan).catch((e) =>
        process.stderr.write(`[engine] task execution error: ${e.message}\n`),
      );
      return;
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
