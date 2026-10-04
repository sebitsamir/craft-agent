#!/usr/bin/env node
/**
 * Headless Engine Daemon
 *
 * This is the server side of the Local Transport (Master Spec Section 10).
 * It reads newline-delimited JSON requests from stdin, routes them to the
 * appropriate capability pack, and writes protocol responses to stdout.
 *
 * Diagnostic logs are written to stderr so they do not corrupt the protocol.
 */
import { createInterface } from 'node:readline';
import { inspect } from './lib/inspect.mjs';
import { verify } from './lib/verify.mjs';
import {
  validateProtocolRequest,
  serializeProtocolMessage,
  parseProtocolMessage,
  CraftError
} from '../packages/contracts/dist/index.js';

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  let request;

  // 1. Parse and validate the protocol envelope
  try {
    const raw = parseProtocolMessage(line);
    request = validateProtocolRequest(raw);
  } catch (err) {
    const errorResponse = {
      protocolVersion: 1,
      requestId: 'unknown',
      success: false,
      error: { code: 'PROTOCOL_MALFORMED', message: err.message },
      timestamp: new Date().toISOString()
    };
    process.stdout.write(serializeProtocolMessage(errorResponse));
    return;
  }

  let result;
  let success = true;
  let errorPayload;

  // 2. Route to the requested capability pack method
  try {
    if (request.method === 'pack.software.inspect') {
      result = await inspect(request.params?.path || '.');
    } else if (request.method === 'pack.software.verify') {
      result = await verify(request.params?.path || '.', request.params?.scripts || []);
    } else {
      throw new CraftError('CAPABILITY_NOT_FOUND', `Unknown method: ${request.method}`);
    }
  } catch (err) {
    success = false;
    errorPayload = {
      code: err.code || 'UNKNOWN_ERROR',
      message: err.message
    };
  }

  // 3. Serialize and write the response
  const response = {
    protocolVersion: 1,
    requestId: request.requestId,
    success,
    ...(success ? { result } : { error: errorPayload }),
    timestamp: new Date().toISOString()
  };

  process.stdout.write(serializeProtocolMessage(response));
});

// Diagnostic log to stderr
process.stderr.write('[engine] Craft Agent headless engine started.\n');
