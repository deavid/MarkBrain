/**
 * recorder — the flight-recorder contract the gateway adapters need (Phase 6).
 *
 * The adapters used to import recordCallStart/recordCallEnd from
 * src/services/callLogStore directly — gateway reaching UP into services.
 * Now they take a CallRecorder as an injected parameter and only record
 * through the interface; the ONE callLogStore import left in the gateway is
 * at the wiring point (gateway/api.ts), which builds the real recorder and
 * hands it down. The recorded fields/kinds are unchanged — the recording
 * CALLS stay inside the adapters, only the import direction died.
 *
 * The shapes mirror LocalRecordCallStartInput/LocalRecordCallEndInput
 * (src/services/callLogStore) exactly, so the store-backed implementation
 * satisfies this interface structurally.
 */
import type { ApiCallKind, ApiCallLogRequest, ApiCallStatus } from '../domains/callLogTypes';

export interface CallRecordStartInput {
  kind: ApiCallKind;
  provider: string;
  model: string;
  request: ApiCallLogRequest;
}

export interface CallRecordEndInput {
  status: Extract<ApiCallStatus, 'ok' | 'error' | 'aborted'>;
  responseText?: string | null;
  usage?: unknown | null;
  error?: string | null;
  turnId?: string | null;
}

export interface CallRecorder {
  /** Fire-and-forget start: generates the id synchronously. */
  start(input: CallRecordStartInput): string;
  ack(id: string | null): void;
  firstToken(id: string | null): void;
  end(id: string | null, extra: CallRecordEndInput): void;
}

/**
 * No-op recorder — the default for direct adapter calls that nobody wired
 * (unit tests hit the adapters directly; the app always passes the real
 * recorder from gateway/api.ts). In the Node test env the real recorder was
 * already a safe no-op (no indexedDB), so behavior is identical either way.
 */
export const noopCallRecorder: CallRecorder = {
  start: () => '',
  ack: () => undefined,
  firstToken: () => undefined,
  end: () => undefined,
};
