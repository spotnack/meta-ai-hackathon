import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  clearJob,
  getPendingJob,
} from "@spotnack/triposg";
import { useGeneratedShapesContext } from "@features/generated-shapes/application/generated-shapes.context";
import { buildGeneratedShapeName } from "@features/generated-shapes/domain/generated-shapes.entity";

import {
  CONVERSION_STATUS,
  ImagePermissionError,
  ImageTo3dCancelledError,
  ImageTo3dUnavailableError,
  clampProgress,
} from "../domain/image-to-3d-conversion.entity";
import { imageLibraryAdapter } from "../infrastructure/image-library.adapter";
import { placeholderImageTo3dAdapter } from "../infrastructure/placeholder-image-to-3d.adapter";
import { demoGoldensImageSourceAdapter } from "../infrastructure/demo-goldens-image-source.adapter";
import { demoGoldensImageTo3dAdapter } from "../infrastructure/demo-goldens-image-to-3d.adapter";
import {
  GENERATOR_ID as TRIPOSG_GENERATOR_ID,
  assertValidJobMeshes,
  attachToTripoSGJob,
  copyCompletedDisplayMesh,
  triposgImageTo3dAdapter,
} from "../infrastructure/triposg-image-to-3d.adapter";
import {
  isDemoImageTo3dMode,
  isOndeviceImageTo3dMode,
} from "../infrastructure/demo-goldens.config";
import { planPersistedJob } from "./persisted-job-plan";

// Demo mode (EXPO_PUBLIC_IMAGE_TO_3D_MODE=demo) adds the cloud-GPU goldens next to the gallery for the
// hackathon demo. On-device mode (EXPO_PUBLIC_IMAGE_TO_3D_MODE=ondevice) sends gallery photos to the
// real TripoSG module when the device is supported and the models are installed; when either is missing
// the conversion falls back to the placeholder (the model-status row explains why), and demo goldens
// keep their adapter in every mode.
const isDemoMode = isDemoImageTo3dMode();
const isOndeviceMode = isOndeviceImageTo3dMode();

// Golden inputs carry demoGoldenId, so each image is converted by the adapter matching its source.
const imageTo3dPortFor = (image) => {
  if (image?.demoGoldenId) return demoGoldensImageTo3dAdapter;
  if (isOndeviceMode) return triposgImageTo3dAdapter;
  return placeholderImageTo3dAdapter;
};

const INITIAL_PROGRESS = { fraction: 0, label: "" };

/**
 * Use case: pick an image, convert it to a 3D model, and save the result as a generated shape.
 * Saving goes through the shared GeneratedShapesContext, so Explore shows the new asset immediately.
 * A running conversion can be stopped with cancelConversion(); stopping never leaves an asset behind.
 *
 * On-device conversions survive backgrounding (foreground service) and, via the
 * persisted job record, returning or relaunching: mounting with a live job
 * reattaches to its events, and mounting with a finished job completes its
 * save exactly like a normal completion. Conversion stops only on the user's
 * Cancel, on error, or if the OS kills the service — never on backgrounding.
 * @returns {{ selectedImage: object|null, status: string, progress: {fraction: number, label: string}, error: {message: string, canOpenSettings: boolean}|null, isPicking: boolean, isConverting: boolean, isCancelling: boolean, canConvert: boolean, canPickDemoImage: boolean, pickImage: function(): Promise<void>, pickDemoImage: function(): Promise<void>, clearImage: function(): void, convert: function(): Promise<void>, cancelConversion: function(): void }} Conversion state and actions.
 */
export const useImageTo3dConversion = () => {
  const { create, remove } = useGeneratedShapesContext();

  const [selectedImage, setSelectedImage] = useState(null);
  const [status, setStatus] = useState(CONVERSION_STATUS.IDLE);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [error, setError] = useState(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Guards against double taps landing before the re-render that disables the buttons.
  const isBusy = useRef(false);
  // Controller of the running conversion, if any.
  const conversionAbortController = useRef(null);
  // Guards the mount resume against StrictMode double effects.
  const resumeStarted = useRef(false);

  // Leaving the screen (e.g. signing out) stops a running conversion: the
  // save pipeline (create/remove below) is torn down with it. Backgrounding
  // alone never stops anything — that is the foreground service's job.
  useEffect(() => () => conversionAbortController.current?.abort(), []);

  const isConverting = status === CONVERSION_STATUS.CONVERTING;

  // Saves a finished port result as a generated shape, with the
  // stop-while-saving undo shared by fresh, reattached and resumed runs.
  const settleResult = useCallback(async (resultPromise, image, abortController) => {
    try {
      const { model, generator } = await resultPromise;
      const created = await create({
        name: buildGeneratedShapeName(image.fileName),
        sourceImageUri: image.uri,
        model,
        generator,
      });
      // Stopped while the asset was being saved: undo it, so stopping never leaves an asset behind.
      if (abortController.signal.aborted) {
        await remove(created.id).catch((err) =>
          console.warn("- Couldn't undo a stopped conversion:", err),
        );
        throw new ImageTo3dCancelledError();
      }
      setStatus(CONVERSION_STATUS.SUCCEEDED);
    } catch (err) {
      setStatus(CONVERSION_STATUS.IDLE);
      // Stopping is the user's choice, not a failure: back to the selected image, no error.
      if (abortController.signal.aborted || err instanceof ImageTo3dCancelledError) {
        setProgress(INITIAL_PROGRESS);
        return;
      }
      console.error("- Image-to-3D conversion failed:", err);
      setError({
        message: err?.message || "Conversion failed. Please try again.",
        canOpenSettings: false,
      });
    } finally {
      if (conversionAbortController.current === abortController) {
        conversionAbortController.current = null;
      }
      setIsCancelling(false);
      isBusy.current = false;
    }
  }, [create, remove]);

  const reportProgress = useCallback(({ fraction, label }) => {
    setProgress({ fraction: clampProgress(fraction), label });
  }, []);

  // Return/relaunch resume: reattach to a live job, or finish a done one.
  useEffect(() => {
    if (!isOndeviceMode || Platform.OS !== "android") return undefined;
    let active = true;
    (async () => {
      let record = null;
      try {
        record = await getPendingJob();
      } catch (err) {
        console.warn("- Couldn't read the persisted conversion job:", err);
        return;
      }
      if (!active || !record) return;
      const plan = planPersistedJob(record);
      if (plan.action === "none" || plan.action === "dismiss") {
        clearJob(record.jobId).catch(() => {});
        return;
      }
      if (plan.action === "report") {
        setError({ message: plan.message, canOpenSettings: false });
        clearJob(record.jobId).catch(() => {});
        return;
      }
      if (isBusy.current || resumeStarted.current) return;
      resumeStarted.current = true;
      const image = {
        uri: record.imageUri,
        width: record.width || 0,
        height: record.height || 0,
        fileName: record.fileName,
        mimeType: null,
      };
      isBusy.current = true;
      const abortController = new AbortController();
      conversionAbortController.current = abortController;
      setSelectedImage(image);
      setError(null);
      if (plan.action === "complete") {
        setStatus(CONVERSION_STATUS.CONVERTING);
        setProgress({ fraction: 1, label: "Done" });
        try {
          // Only a done record with both finished meshes present and
          // byte-valid is ever saved: a killed run's leftovers fail
          // here, never as a broken creation in Explore.
          await assertValidJobMeshes(record);
          const model = await copyCompletedDisplayMesh(record.displayMeshUri);
          if (!active) return;
          await settleResult(
            Promise.resolve({ model, generator: TRIPOSG_GENERATOR_ID }),
            image,
            abortController,
          );
        } catch (err) {
          console.error("- Image-to-3D resume failed:", err);
          setStatus(CONVERSION_STATUS.IDLE);
          setError({
            message: err?.message || "Conversion failed. Please try again.",
            canOpenSettings: false,
          });
          isBusy.current = false;
          if (conversionAbortController.current === abortController) {
            conversionAbortController.current = null;
          }
        } finally {
          clearJob(record.jobId).catch(() => {});
        }
        return;
      }
      // attach: a live worker is still running.
      setStatus(CONVERSION_STATUS.CONVERTING);
      setProgress({
        fraction: clampProgress(record.fraction),
        label: record.label || "Starting",
      });
      await settleResult(
        attachToTripoSGJob({
          jobId: record.jobId,
          steps: record.steps || 50,
          onProgress: reportProgress,
          signal: abortController.signal,
        }),
        image,
        abortController,
      );
    })();
    return () => {
      active = false;
    };
  }, [reportProgress, settleResult]);

  const pickFrom = useCallback(async (imageSourcePort) => {
    if (isBusy.current) return;
    isBusy.current = true;
    setIsPicking(true);
    try {
      const image = await imageSourcePort.pickImage();
      // Cancelling keeps whatever was selected before.
      if (!image) return;
      setSelectedImage(image);
      setStatus(CONVERSION_STATUS.IDLE);
      setProgress(INITIAL_PROGRESS);
      setError(null);
    } catch (err) {
      setError({
        message:
          err instanceof ImagePermissionError
            ? err.message
            : "Couldn't open your photo library. Please try again.",
        canOpenSettings:
          err instanceof ImagePermissionError && !err.canAskAgain,
      });
    } finally {
      setIsPicking(false);
      isBusy.current = false;
    }
  }, []);

  const pickImage = useCallback(() => pickFrom(imageLibraryAdapter), [pickFrom]);

  // Demo mode only: cycles to the next of the 5 cloud-GPU golden inputs.
  const pickDemoImage = useCallback(
    () => pickFrom(demoGoldensImageSourceAdapter),
    [pickFrom],
  );

  const clearImage = useCallback(() => {
    if (isBusy.current) return;
    setSelectedImage(null);
    setStatus(CONVERSION_STATUS.IDLE);
    setProgress(INITIAL_PROGRESS);
    setError(null);
  }, []);

  const convert = useCallback(async () => {
    if (!selectedImage || isBusy.current) return;
    isBusy.current = true;
    const abortController = new AbortController();
    conversionAbortController.current = abortController;
    setStatus(CONVERSION_STATUS.CONVERTING);
    setProgress(INITIAL_PROGRESS);
    setError(null);
    const port = imageTo3dPortFor(selectedImage);
    const request = {
      image: selectedImage,
      signal: abortController.signal,
      onProgress: reportProgress,
    };
    const getResult = async () => {
      try {
        return await port.convertImageTo3d(request);
      } catch (err) {
        // On-device unavailable (unsupported device or missing models):
        // fall back to the placeholder so the workflow keeps working.
        // The model-status row carries the reason.
        if (port === triposgImageTo3dAdapter && err instanceof ImageTo3dUnavailableError) {
          return placeholderImageTo3dAdapter.convertImageTo3d(request);
        }
        throw err;
      }
    };
    await settleResult(getResult(), selectedImage, abortController);
  }, [selectedImage, reportProgress, settleResult]);

  const cancelConversion = useCallback(() => {
    const abortController = conversionAbortController.current;
    if (!abortController || abortController.signal.aborted) return;
    setIsCancelling(true);
    abortController.abort();
  }, []);

  return {
    selectedImage,
    status,
    progress,
    error,
    isPicking,
    isConverting,
    isCancelling,
    canConvert: Boolean(selectedImage) && !isConverting && !isPicking,
    canPickDemoImage: isDemoMode,
    pickImage,
    pickDemoImage,
    clearImage,
    convert,
    cancelConversion,
  };
};
