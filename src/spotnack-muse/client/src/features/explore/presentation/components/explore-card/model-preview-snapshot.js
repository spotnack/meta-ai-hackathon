/*
Saves a still of a model the first time it renders live, so its card can
show a picture of the model (not a generic placeholder) whenever it cannot
hold a live 3D view (GL lease cap, conversion running).

Only the user's own creations ask for this (CategoryItem.previewSnapshotUri);
the bundled food models ship pre-rendered stills. Saved stills are also kept
in memory, so every card showing the same creation switches at once,
before the library list is read again.
*/

import { GLView } from "expo-gl";
import { File } from "expo-file-system";

const saved = new Map();
const inFlight = new Set();
const listeners = new Set();

/**
 * A still saved in this app session for a target path, if any.
 * @param {string|null|undefined} targetUri - CategoryItem.previewSnapshotUri.
 * @returns {string|null} The saved still's URI.
 */
export function getSavedModelPreview(targetUri) {
  return (targetUri && saved.get(targetUri)) || null;
}

/**
 * Subscribes to newly saved stills.
 * @param {function(string, string): void} listener - Called with (targetUri, savedUri).
 * @returns {function(): void} Unsubscribe function.
 */
export function subscribeModelPreviews(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads the current frame of a live canvas and saves it as a PNG at targetUri.
 * Runs once per target (repeat calls while saving, or after, are no-ops).
 * @param {object} glContext - The canvas's expo-gl context (renderer.getContext()).
 * @param {string} targetUri - Where to save the still.
 * @returns {Promise<string|null>} The saved URI, or null when nothing was saved.
 */
export async function saveModelPreview(glContext, targetUri) {
  if (!glContext || !targetUri || saved.has(targetUri) || inFlight.has(targetUri)) {
    return null;
  }
  inFlight.add(targetUri);
  try {
    const target = new File(targetUri);
    if (!target.exists) {
      const snapshot = await GLView.takeSnapshotAsync(glContext, { format: "png" });
      const source = snapshot?.localUri ?? snapshot?.uri;
      if (typeof source !== "string") return null;
      await new File(source.startsWith("file:") ? source : `file://${source}`).move(target);
    }
    saved.set(targetUri, target.uri);
    listeners.forEach((listener) => {
      try {
        listener(targetUri, target.uri);
      } catch (err) {
        console.warn(`- A model preview listener failed: ${err?.message}`);
      }
    });
    return target.uri;
  } catch (err) {
    // A missing still only costs the static look; never break the card.
    console.warn(`- Could not save the model preview: ${err?.message}`);
    return null;
  } finally {
    inFlight.delete(targetUri);
  }
}
