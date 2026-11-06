/*
Global cap on concurrent live GL views: at most MAX_LIVE_GL_VIEWS cards may
mount a 3D canvas at once, even when idle. Each live GLView pins a native
GL context; several mounting together (a horizontal Explore list keeps a
window of cards mounted) exhausts them and trips expo-gl's fatal
"GL is currently not available" path.

The grant goes to the most recently acquired leases: scrolling a new card
into view takes the grant from the least recently seen one, whose viewer
unmounts back to its static thumbnail. Registration persists while a card
wants GL (it may regain the grant when others release); the native context
is only held while actually granted, because only granted cards mount Canvas.
*/

import { useEffect, useReducer } from "react";

export const MAX_LIVE_GL_VIEWS = 2;

let acquisitionSeq = 0;
const holders = new Map();
const listeners = new Set();

/**
 * Notifies every subscriber; one bad listener never breaks the rest.
 */
function notifyLeaseChange() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.warn(`- A GL lease listener failed: ${err?.message}`);
    }
  });
}

/**
 * Subscribes to grant changes (acquire/release by any card).
 * @param {function(): void} listener - Called with no arguments on every change.
 * @returns {function(): void} Unsubscribe function.
 */
export function subscribeGlLeases(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers (or refreshes) a card's lease request.
 * @param {string} id - Card/item id.
 */
export function acquireGlLease(id) {
  if (!id) return;
  acquisitionSeq += 1;
  holders.set(id, acquisitionSeq);
  notifyLeaseChange();
}

/**
 * Drops a card's lease request, freeing its grant for the next card.
 * @param {string} id - Card/item id.
 */
export function releaseGlLease(id) {
  if (holders.delete(id)) {
    notifyLeaseChange();
  }
}

/**
 * Whether a card currently holds a live-view grant: one of the
 * MAX_LIVE_GL_VIEWS most recently acquired leases.
 * @param {string} id - Card/item id.
 * @returns {boolean} True when the card may mount its 3D canvas.
 */
export function hasGlLease(id) {
  const ranked = [...holders.entries()].sort((a, b) => b[1] - a[1]);
  return ranked
    .slice(0, MAX_LIVE_GL_VIEWS)
    .some(([holderId]) => holderId === id);
}

/**
 * Clears every lease. Tests use it to isolate cases; the app never calls it.
 */
export function resetGlLeases() {
  holders.clear();
}

/**
 * React binding: registers while `wanted`, re-renders on grant changes.
 * @param {string} id - Card/item id.
 * @param {boolean} wanted - Whether the card wants a live view right now.
 * @returns {boolean} Whether the card may mount its 3D canvas.
 */
export function useGlViewLease(id, wanted) {
  const [, bumpGrantsSeen] = useReducer((count) => count + 1, 0);
  useEffect(() => subscribeGlLeases(bumpGrantsSeen), [bumpGrantsSeen]);
  useEffect(() => {
    if (!wanted) {
      releaseGlLease(id);
      return undefined;
    }
    acquireGlLease(id);
    return () => releaseGlLease(id);
  }, [id, wanted]);
  return Boolean(wanted) && hasGlLease(id);
}
