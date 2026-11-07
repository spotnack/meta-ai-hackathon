/*
Input-quality warnings from the cut-out preview's mask stats (see
nativeCutout / AnalyzeMask in the TripoSG module). Non-blocking: every
warning still lets the user Convert.

Thresholds (justified where the stats are defined in preprocess.h):
- multiple: 2+ disconnected mask components, each over 5% of the mask
  area (the 5% rule lives in AnalyzeMask: u2net speckle is sub-1%,
  a second subject is comparable in size to the first).
- empty: the mask covers under 5% of the frame — too few subject pixels
  for a reliable reconstruction, whatever the cause.
*/

/** This many big components: more than one object. */
export const MULTI_MIN_COMPONENTS = 2;

/** Mask below this fraction of the frame: no clear object. */
export const EMPTY_MIN_AREA_FRAC = 0.05;

export const CUTOUT_WARNING_MULTIPLE = "multiple";
export const CUTOUT_WARNING_EMPTY = "empty";

/**
 * Maps cut-out mask stats to friendly, non-blocking warnings.
 * @param {{bigComponents: number, maskAreaFrac: number}|null|undefined} stats - Mask stats from previewCutout, if any.
 * @returns {Array<{id: string, message: string}>} Warnings in display order (empty when the input looks fine).
 */
export function warningsForCutoutStats(stats) {
  if (!stats) return [];
  const warnings = [];
  if ((stats.maskAreaFrac ?? 0) < EMPTY_MIN_AREA_FRAC) {
    warnings.push({
      id: CUTOUT_WARNING_EMPTY,
      message:
        "No clear object found — the subject may be too small or the background too busy.",
    });
    return warnings;
  }
  if ((stats.bigComponents ?? 0) >= MULTI_MIN_COMPONENTS) {
    warnings.push({
      id: CUTOUT_WARNING_MULTIPLE,
      message:
        "Looks like more than one object — the model works best with a single subject.",
    });
  }
  return warnings;
}
