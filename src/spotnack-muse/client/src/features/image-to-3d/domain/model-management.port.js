/**
 * @file Contract for on-device TripoSG model management (download, verify, delete).
 *
 * ModelManagementPort is satisfied by model-management.adapter.js, which wraps the
 * `triposg` native module (@spotnack/triposg) plus the GENERATED manifest copy
 * (triposg-models.manifest.js). Model files live in the app-specific external dir
 * the sideload script uses; the downloader writes the same layout, so a sideloaded
 * set and a downloaded set are interchangeable.
 * @typedef {object} ModelManagementPort
 * @property {() => Promise<ModelManagementState>} getState - Derives the current state from the device (no caching: restart-safe).
 * @property {(options?: {allowMetered?: boolean, onStarted?: function(ModelManagementState): void}) => Promise<ModelManagementState>} startDownload - Downloads missing files (resumes partials); onStarted fires once the download is running, with the Downloading state. Rejects with ModelMeteredNetworkError on a metered link without allowMetered, ModelSpaceError when the disk cannot hold the remainder, ModelSideloadRequiredError when no base URL is configured.
 * @property {() => Promise<ModelManagementState>} pauseDownload - Pauses a running download (re-call startDownload to resume, including after a restart).
 * @property {(options?: {onStarted?: function(ModelManagementState): void}) => Promise<ModelManagementState>} verifyModels - Full SHA-256 verification (~7 GB streamed on-device); corrupt files mark the set corrupt. onStarted fires at once with the Verifying state.
 * @property {() => Promise<ModelManagementState>} deleteModels - Deletes the installed (or partial) model dir.
 */

/**
 * @typedef {object} ModelManagementState
 * @property {string} status - One of MODEL_STATUS.
 * @property {string|null} version - Manifest version on disk (or bundled, when nothing is installed).
 * @property {number} downloadedBytes - Bytes already on disk for the version.
 * @property {number} totalBytes - Manifest total for the version.
 * @property {string|null} reason - Human-readable detail (unsupported reason, corrupt file, sideload hint).
 * @property {boolean} fullyVerified - True when INSTALLED and a full SHA-256 verification passed in this app session.
 */

export const MODEL_STATUS = Object.freeze({
  NOT_INSTALLED: "not-installed",
  DOWNLOADING: "downloading",
  PAUSED: "paused",
  VERIFYING: "verifying",
  INSTALLED: "installed",
  CORRUPT: "corrupt",
  UNSUPPORTED: "unsupported",
});

/**
 * Raised by startDownload on a metered link (cellular) without explicit opt-in.
 */
export class ModelMeteredNetworkError extends Error {
  /**
   *
   */
  constructor() {
    super(
      "Models are ~7 GB. Connect to Wi-Fi or confirm a mobile-data download.",
    );
    this.name = "ModelMeteredNetworkError";
  }
}

/**
 * Raised by startDownload when the disk cannot hold the remaining bytes.
 */
export class ModelSpaceError extends Error {
  /**
   * @param {number} needBytes - Remaining bytes to download.
   * @param {number} freeBytes - Usable bytes on the model volume.
   */
  constructor(needBytes, freeBytes) {
    super(
      `Not enough free space for the models (need ${formatBytes(needBytes)}, ${formatBytes(freeBytes)} free).`,
    );
    this.name = "ModelSpaceError";
    this.needBytes = needBytes;
    this.freeBytes = freeBytes;
  }
}

/**
 * Raised by startDownload when no EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL is configured.
 * The UI then explains sideloading (bench/sideload_models.sh) and offers Verify.
 */
export class ModelSideloadRequiredError extends Error {
  /**
   *
   */
  constructor() {
    super(
      "No model server is configured in this build. Sideload the models with bench/sideload_models.sh, then tap Verify.",
    );
    this.name = "ModelSideloadRequiredError";
  }
}

/**
 * Formats a byte count for status copy ("6.1 GB", "820 MB").
 * @param {number} bytes - Byte count.
 * @returns {string} Human-readable size.
 */
export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

export {};
