import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

/*
JS surface of the on-device TripoSG Expo module (part A: engine + status;
part B adds the adapter, model download UI, and hook swap).

Threading: every native call runs off the JS thread (Expo AsyncFunction
default + a dedicated single-thread native executor for conversions).
Progress and completion arrive as events; convert() resolves as soon as
the job is queued and reports through onProgress/onDone/onError.
*/

const TripoSGNative = Platform.OS === "web" ? null : requireNativeModule("TripoSG");

/**
 * Throws when the module is unavailable (web) so callers fail loudly.
 * @returns {object} The native module.
 */
function native() {
  if (!TripoSGNative) {
    throw new Error("On-device TripoSG needs the iOS or Android app.");
  }
  return TripoSGNative;
}

/**
 * Device + model status for preflight UI.
 * @returns {Promise<{supported: boolean, reason: string, modelDir: string|null, modelVersion: string|null, modelsVerified: boolean|null}>} Status.
 */
export function getStatus() {
  return native().getStatus();
}

/**
 * Verifies the downloaded models: sizes always, SHA-256 per file when full.
 * Full verification streams ~7 GB and reports progress through onProgress
 * with jobId "verifyModels".
 * @param {{full?: boolean}} [options] - Pass { full: true } to hash every file.
 * @returns {Promise<{ok: boolean, problem: string|null}>} Verification outcome.
 */
export function verifyModels(options) {
  return native().verifyModels(options ?? {});
}

/**
 * Queues one image-to-3D conversion. Resolves with the job id; the result
 * arrives via onDone/onError. The engine runs inside a foreground service
 * (ongoing notification with Cancel), so the run survives backgrounding;
 * the job is also persisted for return/relaunch resume (getPendingJob).
 * @param {{imageUri: string, fileName?: string|null, imageWidth?: number, imageHeight?: number, steps?: number, guidance?: number, seed?: number, depth?: {d0: number, d1: number}, targetTris?: number}} request - Conversion request (defaults: 50 steps, guidance 7.0, d0 6 / d1 8, 100k display tris). fileName/dimensions are persisted so a relaunch can finish the save.
 * @returns {Promise<string>} The job id.
 */
export function convert(request) {
  if (!request?.imageUri) throw new Error("convert needs imageUri.");
  return native().convert(request);
}

/**
 * Reads the persisted conversion job, if any: a still-running job (live
 * worker), a finished job awaiting its save, or an interrupted one (the
 * process died mid-run; leftovers already deleted).
 * @returns {Promise<{jobId: string, status: string, imageUri: string, fileName: string|null, width: number, height: number, steps: number, fraction: number, label: string, outDir: string, meshUri: string|null, displayMeshUri: string|null, error: string|null}|null>} The record, or null when idle.
 */
export function getPendingJob() {
  return native().getPendingJob();
}

/**
 * Deletes a terminal persisted job record (never a live one).
 * @param {string} jobId - Job from getPendingJob().
 * @returns {Promise<boolean>} True when the record was cleared.
 */
export function clearJob(jobId) {
  return native().clearJob(jobId);
}

/**
 * Stops a queued or running job (conversion or full verification).
 * @param {string} jobId - Job from convert(), or "verifyModels".
 * @returns {Promise<boolean>} True when a matching job was signalled.
 */
export function cancel(jobId) {
  return native().cancel(jobId);
}

/**
 * Drops resident NPU sessions. The native side calls this itself on
 * memory pressure while idle; JS no longer calls it on backgrounding
 * (a backgrounded conversion keeps its sessions by design).
 * @returns {Promise<boolean>} Always true.
 */
export function release() {
  return native().release();
}

/**
 * Space + network answers for the download confirmation UI.
 * @param {{version: string, remainingBytes: number}} request - Version dir and not-yet-downloaded bytes.
 * @returns {Promise<{metered: boolean, freeBytes: number, enoughSpace: boolean}>} Preflight.
 */
export function downloadPreflight(request) {
  return native().downloadPreflight(request);
}

/**
 * Bytes already on disk for this version (finished files + .part files).
 * @param {{version: string, files: Array<{path: string, bytes: number, sha256: string}>}} request - Version and manifest files.
 * @returns {Promise<{downloadedBytes: number, totalBytes: number}>} Disk progress.
 */
export function getDownloadProgress(request) {
  return native().getDownloadProgress(request);
}

/**
 * Downloads every missing model file (per-file resume, SHA-256 verified,
 * rename-after-verify). Re-calling resumes after a pause or a restart.
 * Resolves when finished, paused or failed; progress arrives as
 * onDownloadProgress events.
 * @param {{baseUrl: string, version: string, files: Array<{path: string, bytes: number, sha256: string}>}} request - Source and manifest.
 * @returns {Promise<{status: string, problem: string|null}>} "completed", "paused" or "failed".
 */
export function startDownload(request) {
  return native().startDownload(request);
}

/**
 * Pauses a running download (equivalent to cancel("download"); never
 * touches the C++ engine, so a conversion keeps running).
 * @returns {Promise<boolean>} True when a download was signalled.
 */
export function pauseDownload() {
  return native().pauseDownload();
}

/**
 * Deletes the installed (or partially downloaded) model dir.
 * @param {{version?: string}} [options] - Version to delete (default: newest).
 * @returns {Promise<{ok: boolean}>} Outcome.
 */
export function deleteModels(options) {
  return native().deleteModels(options ?? {});
}

/**
 * Subscribes to download progress (throttled to ~2 Hz).
 * @param {(event: {downloadedBytes: number, totalBytes: number, file: string, fileIndex: number, fileCount: number}) => void} listener - Progress handler.
 * @returns {{remove: () => void}} Subscription.
 */
export function addDownloadProgressListener(listener) {
  return native().addListener("onDownloadProgress", listener);
}

/**
 * Subscribes to conversion progress.
 * @param {(event: {jobId: string, fraction: number, label: string}) => void} listener - Progress handler.
 * @returns {{remove: () => void}} Subscription.
 */
export function addProgressListener(listener) {
  return native().addListener("onProgress", listener);
}

/**
 * Subscribes to conversion completion.
 * @param {(event: {jobId: string, meshUri: string, displayMeshUri: string}) => void} listener - Completion handler.
 * @returns {{remove: () => void}} Subscription.
 */
export function addDoneListener(listener) {
  return native().addListener("onDone", listener);
}

/**
 * Subscribes to conversion failures (code "cancelled" or "failed").
 * @param {(event: {jobId: string, code: string, message: string}) => void} listener - Error handler.
 * @returns {{remove: () => void}} Subscription.
 */
export function addErrorListener(listener) {
  return native().addListener("onError", listener);
}
