/**
 * Granularity — UI palette half. The pure vocabulary (Granularity, the cut
 * order, cutIncludes, the chapter-cut law) lives in the client/server contract
 * layer at `shared/granularity.ts` and is re-exported below, so every existing
 * client import path is unchanged.
 *
 * The UI colour palette (AttachmentVisualState, ATTACHMENT_STATE_PALETTE,
 * getAttachmentStatePalette, getGranularityChipClass) lives in
 * `src/ui/context/attachmentPalette.ts` and is anchored by
 * `src/tests/attachment-palette.test.ts`.
 */
import type { Granularity } from '../../shared/granularity';

export * from '../../shared/granularity';
