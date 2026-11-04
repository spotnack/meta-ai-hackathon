import { useCallback, useEffect, useRef, useState } from "react";

import { useGeneratedShapesContext } from "@features/generated-shapes/application/generated-shapes.context";
import { buildGeneratedShapeName } from "@features/generated-shapes/domain/generated-shapes.entity";

import {
  CONVERSION_STATUS,
  ImagePermissionError,
  ImageTo3dCancelledError,
  clampProgress,
} from "../domain/image-to-3d-conversion.entity";
import { imageLibraryAdapter } from "../infrastructure/image-library.adapter";
import { placeholderImageTo3dAdapter } from "../infrastructure/placeholder-image-to-3d.adapter";

// Swap for the real pipeline adapter once it implements ImageTo3dPort (see image-to-3d.port.js).
const imageTo3dPort = placeholderImageTo3dAdapter;
const imageSourcePort = imageLibraryAdapter;

const INITIAL_PROGRESS = { fraction: 0, label: "" };

/**
 * Use case: pick an image, convert it to a 3D model, and save the result as a generated shape.
 * Saving goes through the shared GeneratedShapesContext, so Explore shows the new asset immediately.
 * A running conversion can be stopped with cancelConversion(); stopping never leaves an asset behind.
 * @returns {{ selectedImage: object|null, status: string, progress: {fraction: number, label: string}, error: {message: string, canOpenSettings: boolean}|null, isPicking: boolean, isConverting: boolean, isCancelling: boolean, canConvert: boolean, pickImage: function(): Promise<void>, clearImage: function(): void, convert: function(): Promise<void>, cancelConversion: function(): void }} Conversion state and actions.
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

  // Leaving the screen (e.g. signing out) stops a running conversion.
  useEffect(() => () => conversionAbortController.current?.abort(), []);

  const isConverting = status === CONVERSION_STATUS.CONVERTING;

  const pickImage = useCallback(async () => {
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
    try {
      const { model, generator } = await imageTo3dPort.convertImageTo3d({
        image: selectedImage,
        signal: abortController.signal,
        onProgress: ({ fraction, label }) =>
          setProgress({ fraction: clampProgress(fraction), label }),
      });
      const created = await create({
        name: buildGeneratedShapeName(selectedImage.fileName),
        sourceImageUri: selectedImage.uri,
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
      conversionAbortController.current = null;
      setIsCancelling(false);
      isBusy.current = false;
    }
  }, [selectedImage, create, remove]);

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
    pickImage,
    clearImage,
    convert,
    cancelConversion,
  };
};
