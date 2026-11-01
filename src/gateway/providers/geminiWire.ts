/**
 * Client gateway view of the shared turns-wire mapping (BUG-013): the
 * provider-neutral shape is defined once in shared/stream/turnsWire.ts; this
 * module only re-exports it at the gateway layer boundary.
 */
export {
  geminiWireContents,
  openrouterWireMessages,
  type WireChatMessage,
} from '../../../shared/stream/turnsWire';
