/**
 * @file Domain states and errors for the image-to-3D conversion workflow. No framework imports.
 */

export const CONVERSION_STATUS = Object.freeze({
  IDLE: "idle",
  CONVERTING: "converting",
  SUCCEEDED: "succeeded",
});

/**
 * Raised by an ImageSourcePort when the user has not granted access to their photos.
 */
export class ImagePermissionError extends Error {
  /**
   * @param {boolean} canAskAgain - False when the OS will no longer show the prompt, so only Settings can grant access.
   */
  constructor(canAskAgain) {
    super(
      canAskAgain
        ? "Allow photo access to choose an image."
        : "Photo access is turned off. Enable it in Settings to choose an image.",
    );
    this.name = "ImagePermissionError";
    this.canAskAgain = canAskAgain;
  }
}

/**
 * Raised by an ImageTo3dPort when the conversion was stopped through its AbortSignal.
 * The workflow treats it as a user decision, not a failure.
 */
export class ImageTo3dCancelledError extends Error {
  /**
   * Creates the error with a fixed message.
   */
  constructor() {
    super("Image-to-3D conversion was stopped.");
    this.name = "ImageTo3dCancelledError";
  }
}

/**
 * Clamps a reported progress fraction to [0, 1] so a misbehaving pipeline cannot break the progress bar.
 * @param {number} fraction - Raw progress.
 * @returns {number} Progress between 0 and 1.
 */
export const clampProgress = (fraction) =>
  Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
