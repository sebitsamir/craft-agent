import { JunubError, JunubErrorCode, type JunubErrorPayload } from './errors.js';

export const CURRENT_PROTOCOL_VERSION = 1;

export interface ProtocolRequest {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly method: string;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly params: unknown;
  readonly idempotencyKey?: string;
  readonly timestamp: string;
}

export interface ProtocolResponse {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: JunubErrorPayload;
  readonly timestamp: string;
}

export interface ProtocolEvent {
  readonly protocolVersion: 1;
  readonly taskId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly timestamp: string;
}

export type ProtocolMessage = ProtocolRequest | ProtocolResponse | ProtocolEvent;

export function validateProtocolRequest(raw: unknown): ProtocolRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol request must be an object.');
  }
  const req = raw as Record<string, unknown>;

  if (req.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    throw new JunubError(
      JunubErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
      `Unsupported protocol version: ${String(req.protocolVersion)}. Expected ${CURRENT_PROTOCOL_VERSION}.`,
      { protocolVersion: req.protocolVersion },
    );
  }
  if (typeof req.requestId !== 'string' || !req.requestId.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol request requires a nonempty "requestId".');
  }
  if (typeof req.method !== 'string' || !req.method.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol request requires a nonempty "method".');
  }
  if (typeof req.timestamp !== 'string' || !req.timestamp.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol request requires a nonempty "timestamp".');
  }

  return raw as ProtocolRequest;
}

export function validateProtocolResponse(raw: unknown): ProtocolResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol response must be an object.');
  }
  const res = raw as Record<string, unknown>;

  if (res.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    throw new JunubError(
      JunubErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
      `Unsupported protocol version: ${String(res.protocolVersion)}. Expected ${CURRENT_PROTOCOL_VERSION}.`,
      { protocolVersion: res.protocolVersion },
    );
  }
  if (typeof res.requestId !== 'string' || !res.requestId.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol response requires a nonempty "requestId".');
  }
  if (typeof res.success !== 'boolean') {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol response requires a boolean "success" flag.');
  }
  if (typeof res.timestamp !== 'string' || !res.timestamp.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol response requires a nonempty "timestamp".');
  }

  return raw as ProtocolResponse;
}

export function validateProtocolEvent(raw: unknown): ProtocolEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol event must be an object.');
  }
  const ev = raw as Record<string, unknown>;

  if (ev.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    throw new JunubError(
      JunubErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
      `Unsupported protocol version: ${String(ev.protocolVersion)}. Expected ${CURRENT_PROTOCOL_VERSION}.`,
      { protocolVersion: ev.protocolVersion },
    );
  }
  if (typeof ev.taskId !== 'string' || !ev.taskId.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol event requires a nonempty "taskId".');
  }
  if (typeof ev.sequence !== 'number' || !Number.isInteger(ev.sequence) || ev.sequence < 1) {
    throw new JunubError(
      JunubErrorCode.PROTOCOL_SEQUENCE_INVALID,
      'Protocol event "sequence" must be a positive integer starting at 1.',
      { sequence: ev.sequence },
    );
  }
  if (typeof ev.eventId !== 'string' || !ev.eventId.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol event requires a nonempty "eventId".');
  }
  if (typeof ev.type !== 'string' || !ev.type.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol event requires a nonempty "type".');
  }
  if (typeof ev.timestamp !== 'string' || !ev.timestamp.trim()) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Protocol event requires a nonempty "timestamp".');
  }

  return raw as ProtocolEvent;
}

const MAX_PROTOCOL_PAYLOAD_BYTES = 1048576; // 1 MiB boundary

export function serializeProtocolMessage(message: ProtocolMessage): string {
  const json = JSON.stringify(message);
  if (Buffer.byteLength(json, 'utf8') > MAX_PROTOCOL_PAYLOAD_BYTES) {
    throw new JunubError(
      JunubErrorCode.PROTOCOL_MALFORMED,
      `Protocol message exceeds maximum allowed payload size of ${MAX_PROTOCOL_PAYLOAD_BYTES} bytes.`,
    );
  }
  return `${json}\n`;
}

export function parseProtocolMessage(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new JunubError(JunubErrorCode.PROTOCOL_MALFORMED, 'Cannot parse empty protocol message.');
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new JunubError(
      JunubErrorCode.PROTOCOL_MALFORMED,
      `Failed to parse protocol JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
