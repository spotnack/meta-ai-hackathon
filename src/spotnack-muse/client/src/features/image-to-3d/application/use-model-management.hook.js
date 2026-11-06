import { useCallback, useEffect, useRef, useState } from "react";

import { addDownloadProgressListener } from "@spotnack/triposg";

import {
  MODEL_STATUS,
} from "../domain/model-management.port";
import { modelManagementAdapter } from "../infrastructure/model-management.adapter";
import { isOndeviceImageTo3dMode } from "../infrastructure/demo-goldens.config";

const INITIAL_STATE = Object.freeze({
  status: MODEL_STATUS.NOT_INSTALLED,
  version: null,
  downloadedBytes: 0,
  totalBytes: 0,
  reason: null,
});

/**
 * Use case: own the TripoSG model set (download / pause / resume / verify /
 * delete) and expose its derived state for the model-status row. State is
 * re-derived from the device after every action and on every native download
 * event, so a restart mid-download shows PAUSED with its bytes intact.
 * Outside on-device mode the state stays INITIAL_STATE and every action
 * is a no-op (the card hides the row).
 * @returns {{ modelState: object, actionError: string|null, isWorking: boolean, needsMeteredConfirm: boolean, modelsReady: boolean, refreshModels: function(): Promise<void>, startDownload: function(object?): Promise<void>, pauseDownload: function(): Promise<void>, verifyModels: function(): Promise<void>, deleteModels: function(): Promise<void> }} Model state and actions.
 */
export const useModelManagement = () => {
  const [modelState, setModelState] = useState(INITIAL_STATE);
  const [actionError, setActionError] = useState(null);
  const [isWorking, setIsWorking] = useState(false);
  // Set when startDownload refuses a metered link: the card offers
  // "Download anyway" (startDownload({ allowMetered: true })).
  const [needsMeteredConfirm, setNeedsMeteredConfirm] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const enabled = isOndeviceImageTo3dMode();

  const refreshModels = useCallback(async () => {
    if (!enabled) return;
    try {
      const state = await modelManagementAdapter.getState();
      if (mounted.current) setModelState(state);
    } catch (err) {
      if (mounted.current) {
        setActionError(err?.message ?? "Couldn't read the model status.");
      }
    }
  }, [enabled]);

  // Live byte counts while a download runs (native events are ~2 Hz).
  useEffect(() => {
    if (!enabled) return undefined;
    refreshModels();
    const subscription = addDownloadProgressListener((event) => {
      if (!mounted.current) return;
      setModelState((prev) =>
        prev.status === MODEL_STATUS.DOWNLOADING
          ? {
            ...prev,
            downloadedBytes: event.downloadedBytes,
            totalBytes: event.totalBytes,
          }
          : prev,
      );
    });
    return () => subscription.remove();
  }, [enabled, refreshModels]);

  const runAction = useCallback(
    async (action) => {
      if (!enabled) return;
      setIsWorking(true);
      setActionError(null);
      setNeedsMeteredConfirm(false);
      try {
        const state = await action();
        if (mounted.current) setModelState(state);
      } catch (err) {
        if (mounted.current) {
          setActionError(err?.message ?? "Model action failed.");
          if (err?.name === "ModelMeteredNetworkError") {
            setNeedsMeteredConfirm(true);
          }
        }
      } finally {
        if (mounted.current) setIsWorking(false);
      }
    },
    [enabled],
  );

  const startDownload = useCallback(
    (options) => runAction(() => modelManagementAdapter.startDownload(options)),
    [runAction],
  );
  const pauseDownload = useCallback(
    () => runAction(() => modelManagementAdapter.pauseDownload()),
    [runAction],
  );
  const verifyModels = useCallback(
    () => runAction(() => modelManagementAdapter.verifyModels()),
    [runAction],
  );
  const deleteModels = useCallback(
    () => runAction(() => modelManagementAdapter.deleteModels()),
    [runAction],
  );

  return {
    modelState,
    actionError,
    isWorking,
    needsMeteredConfirm,
    modelsReady: modelState.status === MODEL_STATUS.INSTALLED,
    refreshModels,
    startDownload,
    pauseDownload,
    verifyModels,
    deleteModels,
  };
};
