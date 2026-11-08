import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import { getPendingJob } from "@spotnack/triposg";

import { planPersistedJob } from "./persisted-job-plan";

/**
 * Whether a persisted job record means a conversion is still running.
 * Reuses the resume planner so "running" never drifts from what the
 * conversion hook would reattach to.
 * @param {object|null} record - Persisted job record, if any.
 * @returns {boolean} True for a live worker (planner action "attach").
 */
export const isConversionRecordActive = (record) =>
  planPersistedJob(record).action === "attach";

/**
 * Shared "a conversion is running" signal for screens outside the
 * conversion hook's own tab (e.g. Explore, which must shed GL views while
 * the NPU holds gigabytes of DMA-BUF). Source of truth is the persisted
 * on-device job record, so it also covers service-side runs after a
 * relaunch — not just the current hook instance. Only the on-device
 * adapter ever writes that record, so other modes naturally read false.
 * Checked on mount; callers re-run `recheckConversionRunning` on focus.
 * @returns {{ conversionRunning: boolean, recheckConversionRunning: function(): Promise<boolean> }} The signal and its manual refresh.
 */
export const useConversionRunning = () => {
  const [conversionRunning, setConversionRunning] = useState(false);

  const recheckConversionRunning = useCallback(async () => {
    if (Platform.OS !== "android") {
      setConversionRunning(false);
      return false;
    }
    let record = null;
    try {
      record = await getPendingJob();
    } catch (err) {
      console.warn("- Couldn't read the persisted conversion job:", err);
      setConversionRunning(false);
      return false;
    }
    const active = isConversionRecordActive(record);
    setConversionRunning(active);
    return active;
  }, []);

  useEffect(() => {
    recheckConversionRunning();
  }, [recheckConversionRunning]);

  return { conversionRunning, recheckConversionRunning };
};
