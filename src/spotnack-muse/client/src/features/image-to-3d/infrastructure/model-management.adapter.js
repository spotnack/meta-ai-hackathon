import {
  deleteModels,
  downloadPreflight,
  getDownloadProgress,
  getStatus,
  pauseDownload,
  startDownload,
  verifyModels,
} from "@spotnack/triposg";

import {
  MODEL_STATUS,
  ModelMeteredNetworkError,
  ModelSideloadRequiredError,
  ModelSpaceError,
} from "../domain/model-management.port";
import { TRIPOSG_MODELS_MANIFEST } from "./triposg-models.manifest";

/*
Infrastructure adapter implementing ModelManagementPort (model-management.port.js)
over the `triposg` native module.

State is derived, never cached: getState() reads the device (preflight, quick
size check, bytes on disk) plus two in-memory flags (a download or a full
verification started through this adapter and not yet settled). A killed app
therefore restarts in PAUSED when .part files exist, INSTALLED when sizes
match, and NOT_INSTALLED otherwise — resume-after-restart falls out of the
native Range downloader with no persisted JS state.

getStatus().modelsVerified is the cheap size check. Only verifyModels()
(full SHA-256, minutes on ~7 GB) promotes a size-ok set to verified, and only
its failure marks a set CORRUPT: a size mismatch alone is PAUSED (resumable)
or NOT_INSTALLED, never corrupt.
*/

const MANIFEST = TRIPOSG_MODELS_MANIFEST;

const getModelBaseUrl = () =>
  process.env.EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL ?? null;

const SIDELOAD_HINT =
  "No model server in this build — sideload with bench/sideload_models.sh, then Verify.";

// True while startDownload's promise is unsettled through this adapter.
let downloadActive = false;
// True while verifyModels({full: true}) is unsettled through this adapter.
let verifyingActive = false;
// Remembers a failed full verification until the next download/delete.
let corruptProblem = null;
// True after a full verification passed in this app process (the card then
// labels the button Verified). Cleared by a download, delete or failure.
let fullyVerified = false;

const baseState = (status, downloadedBytes, reason = null) => ({
  status,
  version: MANIFEST.version,
  downloadedBytes,
  totalBytes: MANIFEST.totalBytes,
  reason,
  fullyVerified: status === MODEL_STATUS.INSTALLED && fullyVerified,
});

const diskProgress = async () => {
  const { downloadedBytes } = await getDownloadProgress({
    version: MANIFEST.version,
    files: MANIFEST.files,
  });
  return downloadedBytes;
};

const deriveState = async () => {
  let status;
  try {
    status = await getStatus();
  } catch (err) {
    // Web (or a build without the native module): on-device is unavailable.
    return baseState(
      MODEL_STATUS.UNSUPPORTED,
      0,
      err?.message ?? "On-device TripoSG needs the Android app.",
    );
  }
  if (!status.supported) {
    return baseState(MODEL_STATUS.UNSUPPORTED, 0, status.reason);
  }
  if (downloadActive) {
    return baseState(
      MODEL_STATUS.DOWNLOADING,
      await diskProgress(),
    );
  }
  if (verifyingActive) {
    return baseState(
      MODEL_STATUS.VERIFYING,
      await diskProgress(),
    );
  }
  if (corruptProblem) {
    return baseState(
      MODEL_STATUS.CORRUPT,
      await diskProgress(),
      corruptProblem,
    );
  }
  if (status.modelsVerified) {
    return baseState(MODEL_STATUS.INSTALLED, MANIFEST.totalBytes);
  }
  const downloadedBytes = await diskProgress();
  if (downloadedBytes > 0) {
    return baseState(MODEL_STATUS.PAUSED, downloadedBytes);
  }
  return baseState(
    MODEL_STATUS.NOT_INSTALLED,
    0,
    getModelBaseUrl() ? null : SIDELOAD_HINT,
  );
};

/** @type {import("../domain/model-management.port").ModelManagementPort} */
export const modelManagementAdapter = {
  getState: () => deriveState(),

  startDownload: async ({ allowMetered = false, onStarted } = {}) => {
    // A second tap while a download runs would make the native side refuse
    // ("already running") and clear downloadActive: report the live state.
    if (downloadActive) return deriveState();
    const baseUrl = getModelBaseUrl();
    if (!baseUrl) throw new ModelSideloadRequiredError();
    const status = await getStatus();
    if (!status.supported) {
      return baseState(MODEL_STATUS.UNSUPPORTED, 0, status.reason);
    }
    if (status.modelsVerified) {
      return baseState(MODEL_STATUS.INSTALLED, MANIFEST.totalBytes);
    }
    const downloadedBytes = await diskProgress();
    const preflight = await downloadPreflight({
      version: MANIFEST.version,
      remainingBytes: MANIFEST.totalBytes - downloadedBytes,
    });
    if (!preflight.enoughSpace) {
      throw new ModelSpaceError(
        MANIFEST.totalBytes - downloadedBytes,
        preflight.freeBytes,
      );
    }
    if (preflight.metered && !allowMetered) {
      throw new ModelMeteredNetworkError();
    }
    // A corrupt set keeps size-matching files on disk that the resumable
    // downloader would otherwise skip: wipe them so the retry is fresh.
    if (corruptProblem) {
      await deleteModels({});
    }
    corruptProblem = null;
    fullyVerified = false;
    downloadActive = true;
    // The native call only returns when the whole download ends, so tell
    // the caller now that it is running (the card switches to Downloading).
    onStarted?.(baseState(MODEL_STATUS.DOWNLOADING, downloadedBytes));
    try {
      const outcome = await startDownload({
        baseUrl,
        version: MANIFEST.version,
        files: MANIFEST.files,
      });
      if (outcome.status === "failed") {
        throw new Error(outcome.problem ?? "Model download failed.");
      }
    } finally {
      downloadActive = false;
    }
    return deriveState();
  },

  pauseDownload: async () => {
    downloadActive = false;
    await pauseDownload();
    return deriveState();
  },

  verifyModels: async ({ onStarted } = {}) => {
    if (verifyingActive) return deriveState();
    verifyingActive = true;
    // The native check only returns when all files are hashed (minutes):
    // tell the caller now so the card shows Verifying.
    onStarted?.(baseState(MODEL_STATUS.VERIFYING, MANIFEST.totalBytes));
    try {
      const outcome = await verifyModels({ full: true });
      if (outcome.ok) {
        corruptProblem = null;
        fullyVerified = true;
      } else if (outcome.problem !== "cancelled") {
        corruptProblem = outcome.problem ?? "verification failed";
        fullyVerified = false;
      }
    } finally {
      verifyingActive = false;
    }
    return deriveState();
  },

  deleteModels: async () => {
    corruptProblem = null;
    fullyVerified = false;
    await deleteModels({ version: MANIFEST.version });
    return deriveState();
  },
};
