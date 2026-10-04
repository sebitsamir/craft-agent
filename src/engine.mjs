#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { inspect } from './lib/inspect.mjs';
import { verify } from './lib/verify.mjs';
import { inspectFilmProject, verifyMediaLinks, applyFilmPatch } from '../packs/film/dist/index.js';
import {
  serializeProtocolMessage,
  parseProtocolMessage,
} from '../packages/contracts/dist/index.js';

const rl = createInterface({ input: process.stdin, terminal: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      result = { taskId, status: 'accepted' };
      simulateTaskProgress(taskId, contract).catch((e) =>
        process.stderr.write(`[engine] task simulation error: ${e.message}\n`),
      );
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

async function simulateTaskProgress(taskId, task) {
  let seq = 1;
  const emit = (type, payload) => {
    try {
      process.stdout.write(
        serializeProtocolMessage({
          protocolVersion: 1,
          taskId,
          sequence: seq++,
          eventId: `evt-${seq}`,
          type,
          payload,
          timestamp: new Date().toISOString(),
        }) + '\n',
      );
    } catch (e) {
      process.stderr.write(`[engine] emit failed: ${e.message}\n`);
    }
  };

  emit('task.created', { title: task.title });
  await sleep(300);
  emit('task.started', {});

  for (let i = 0; i < task.acceptance.length; i++) {
    const crit = task.acceptance[i];
    const stepId = crit.id || `step-${i}`;
    emit('step.queued', { stepId, statement: crit.statement });
    await sleep(400);
    emit('step.started', { stepId });
    await sleep(800 + Math.random() * 1200);
    if (Math.random() > 0.2) {
      emit('step.succeeded', { stepId });
    } else {
      emit('step.failed', { stepId, message: 'Simulated criterion failure' });
    }
  }

  emit('task.succeeded', {});
}

process.stderr.write('[engine] Junub Agent headless engine started.\n');