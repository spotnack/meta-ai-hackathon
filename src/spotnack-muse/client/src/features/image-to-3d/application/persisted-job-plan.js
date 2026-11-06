/**
 * @file Decides what the conversion hook does with a persisted TripoSG job
 * (see TripoSGJobs.kt + getPendingJob). Pure function of the record, so the
 * resume/complete matrix is unit-testable without rendering the hook.
 */

/**
 * @typedef {object} PersistedJobPlan
 * @property {string} action - One of "none", "attach", "complete", "report", "dismiss".
 * @property {string|null} [message] - Card-ready copy for "report".
 */

const INTERRUPTED_MESSAGE =
  "The conversion was interrupted before it finished. Convert again to retry.";

/**
 * Maps a persisted job record (or null) to the hook's next step.
 * - none: idle, nothing persisted.
 * - attach: a live worker is still running; reattach to its events.
 * - complete: finished meshes await their save into generated shapes.
 * - report: failed or interrupted; show the message, then clear.
 * - dismiss: user-cancelled; clear silently.
 * @param {object|null} record - getPendingJob() result.
 * @returns {PersistedJobPlan} The plan.
 */
export const planPersistedJob = (record) => {
  if (!record) return { action: "none" };
  switch (record.status) {
  case "running":
    return { action: "attach" };
  case "done":
    return { action: "complete" };
  case "failed":
    return {
      action: "report",
      message: record.error || "Conversion failed. Please try again.",
    };
  case "interrupted":
    return { action: "report", message: INTERRUPTED_MESSAGE };
  case "cancelled":
  default:
    return { action: "dismiss" };
  }
};
