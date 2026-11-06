/*
Pure policy for Explore cards: live 3D vs static thumbnail.

- No model URI: there is nothing to render live ("none" — the caller shows
  the photo placeholder, as today).
- A conversion is running (`previewOnly`): every card shows its static
  thumbnail and no card holds a GL context. This sheds GPU/RAM exactly when
  the NPU has pinned gigabytes of DMA-BUF for the conversion.
- Otherwise a card renders live only while it holds a lease ("live");
  without one it keeps its static thumbnail ("static").

`takeVisibleIds` picks which cards may compete for the global lease pool:
the first MAX_LIVE_GL_VIEWS currently viewable cards, in list order.
*/

import { MAX_LIVE_GL_VIEWS } from "./gl-view-lease";

export const LIVE_PREVIEW = "live";
export const STATIC_PREVIEW = "static";
export const NO_PREVIEW = "none";

/**
 * Decides what a card renders for its preview slot.
 * @param {object} card - Preview inputs.
 * @param {string|null|undefined} card.modelUri - Renderable model URI, if any.
 * @param {boolean} card.previewOnly - A conversion is running: static only.
 * @param {boolean} card.leaseGranted - The card holds a live-GL lease.
 * @returns {string} One of LIVE_PREVIEW, STATIC_PREVIEW, NO_PREVIEW.
 */
export function resolveCardPreview({ modelUri, previewOnly, leaseGranted }) {
  if (!modelUri) return NO_PREVIEW;
  if (previewOnly || !leaseGranted) return STATIC_PREVIEW;
  return LIVE_PREVIEW;
}

/**
 * Compares two id lists for the viewability state update.
 * @param {Array<string>} prev - Previous visible ids.
 * @param {Array<string>} next - Candidate visible ids.
 * @returns {boolean} True when both hold the same ids in the same order.
 */
export function sameIdList(prev, next) {
  return (
    prev.length === next.length && prev.every((id, index) => id === next[index])
  );
}

/**
 * Takes the ids of the first `maxVisible` viewable items, in list order.
 * @param {Array<{item: {id: string}}>} viewableItems - FlatList viewable items.
 * @param {number} [maxVisible] - Cap on live cards (defaults to the GL lease cap).
 * @returns {Array<string>} Visible ids eligible for a live view.
 */
export function takeVisibleIds(
  viewableItems,
  maxVisible = MAX_LIVE_GL_VIEWS,
) {
  return (viewableItems ?? [])
    .map((entry) => entry?.item?.id)
    .filter(Boolean)
    .slice(0, maxVisible);
}
