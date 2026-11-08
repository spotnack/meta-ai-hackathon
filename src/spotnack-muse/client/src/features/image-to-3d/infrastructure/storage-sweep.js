import { Platform } from "react-native";

import { deleteSweepPaths, getStorageState } from "@spotnack/triposg";

/**
 * @file Startup sweep for on-device TripoSG leftovers. A saved result no
 * longer needs its job folder (the library owns a copy of the display
 * mesh; the full mesh is only validity-checked), but folders used to be
 * kept for done records — and kills/old builds leave orphans behind. The
 * plan below is a pure function of the native storage state, so the
 * keep/delete matrix is unit-testable; the native side only lists and
 * deletes exactly the child names it is given.
 */

/**
 * @typedef {object} StorageState
 * @property {string[]} [jobDirs] - Child dirs of files/triposg/jobs.
 * @property {{jobId: string, status: string}|null} [record] - Persisted job, if any.
 * @property {boolean} [workerAlive] - A worker owns the engine right now.
 * @property {string[]} [cacheDirs] - Child dirs of cache/triposg.
 * @property {boolean} [debuggable] - Debuggable build (keeps debug output).
 */

/**
 * @typedef {object} SweepPlan
 * @property {string[]} jobDirs - Job child dirs to delete.
 * @property {string[]} cacheDirs - Cache child dirs to delete.
 */

const isCleanChildName = (name) =>
  typeof name === "string" &&
  name !== "" &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  !name.includes("\\");

/**
 * Decides which leftover dirs the startup sweep deletes. Keeps a done
 * record's folder (its save may still complete on mount) and a live
 * worker's folder (a conversion is running); everything else under the
 * jobs dir is an orphan. Under cache/triposg everything goes except the
 * debug dir of a debuggable build (preview URIs are memory-only, so no
 * restart can still need them).
 * @param {StorageState} [state] - Native storage state.
 * @returns {SweepPlan} Child dirs to delete per parent.
 */
export const planStorageSweep = (state) => {
  const current = state ?? {};
  const jobDirs = Array.isArray(current.jobDirs) ? current.jobDirs : [];
  const cacheDirs = Array.isArray(current.cacheDirs) ? current.cacheDirs : [];
  const record = current.record ?? null;
  const keepJobId =
    record?.status === "done" ||
    (record?.status === "running" && current.workerAlive === true)
      ? record.jobId
      : null;
  return {
    jobDirs: jobDirs.filter(
      (name) => isCleanChildName(name) && name !== keepJobId,
    ),
    cacheDirs: cacheDirs.filter(
      (name) =>
        isCleanChildName(name) &&
        !(name === "debug" && current.debuggable === true),
    ),
  };
};

/**
 * Runs the startup sweep once: plans from the native storage state, then
 * deletes. Best-effort and never rejecting — storage must never break app
 * start. Android only (other platforms never create these dirs).
 * @returns {Promise<{deleted: number}>} Deleted top-level dir count.
 */
export const sweepStaleStorage = async () => {
  try {
    if (Platform.OS !== "android") return { deleted: 0 };
    const plan = planStorageSweep(await getStorageState());
    if (plan.jobDirs.length === 0 && plan.cacheDirs.length === 0) {
      return { deleted: 0 };
    }
    return await deleteSweepPaths(plan);
  } catch (err) {
    console.warn("- Storage sweep skipped:", err?.message ?? err);
    return { deleted: 0 };
  }
};
