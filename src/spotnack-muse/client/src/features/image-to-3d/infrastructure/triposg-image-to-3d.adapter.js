import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import {
  addDoneListener,
  addErrorListener,
  addProgressListener,
  cancel,
  clearJob,
  convert,
  getStatus,
} from "@spotnack/triposg";

import { GENERATED_SHAPE_MODEL_FORMATS } from "@features/generated-shapes/domain/generated-shapes.entity";

import {
  ImageTo3dCancelledError,
  ImageTo3dUnavailableError,
} from "../domain/image-to-3d-conversion.entity";

/*
Infrastructure adapter implementing ImageTo3dPort (image-to-3d.port.js) over the
on-device TripoSG Expo module. convert() resolves with a jobId; the mesh arrives
via onDone/onError, so this adapter bridges events into the port promise.

Native stage labels are mapped to card copy; the sampling window ([0.020, 0.950]
in cpp/pipeline.cpp, weighted by the measured phase-2 stage durations) carries
the step counter ("Generating shape (step 12/50)"). The returned model is the
DISPLAY mesh (mesh.display.glb, 100k tris default) copied under Paths.cache —
the full mesh stays in the module's job dir, which the engine deletes on cancel.
*/

export const GENERATOR_ID = "triposg@2c1c516d+qnn-htp-fp16";
const OUTPUT_DIRECTORY_NAME = "image-to-3d";

// Sampling progress window in cpp/pipeline.cpp (kDinoEnd..kSampleEnd).
const SAMPLING_START = 0.02;
const SAMPLING_END = 0.95;

const labelFor = (nativeLabel, fraction, steps) => {
  switch (nativeLabel) {
  case "Isolating subject":
    return "Removing background";
  case "Encoding image":
    return "Encoding image";
  case "Generating geometry": {
    const local = (fraction - SAMPLING_START) / (SAMPLING_END - SAMPLING_START);
    const step = Math.min(steps, Math.max(1, Math.floor(local * steps) + 1));
    return `Generating shape (step ${step}/${steps})`;
  }
  case "Building mesh":
  case "Extracting mesh":
    return "Building mesh";
  case "Writing model":
    return "Simplifying";
  default:
    return nativeLabel;
  }
};

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw new ImageTo3dCancelledError();
};

// glTF 2.0 binary header: magic "glTF", version 2, total length.
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_HEADER_BYTES = 20;

/**
 * Rejects unless the file is a complete glTF 2.0 binary: present,
 * readable, correct magic + version, and a length field matching the
 * actual bytes. Partial engine outputs (killed mid-write) fail here, so
 * an interrupted run can never reach the library as a broken mesh.
 * @param {string} uri - file:// model URI to check.
 * @param {string} which - Human label for error copy ("display mesh", "full mesh").
 * @returns {Promise<void>} Resolves when the file is a valid GLB.
 */
export const assertValidGlb = async (uri, which) => {
  let buffer = null;
  try {
    buffer = await new File(uri).arrayBuffer();
  } catch (err) {
    throw new Error(`Model file is missing or unreadable (${which}).`);
  }
  const bytes = new Uint8Array(buffer);
  let valid = bytes.length >= GLB_HEADER_BYTES;
  if (valid) {
    const view = new DataView(buffer);
    valid =
      view.getUint32(0, true) === GLB_MAGIC &&
      view.getUint32(4, true) === GLB_VERSION &&
      view.getUint32(8, true) === bytes.length;
  }
  if (!valid) {
    throw new Error(`Model file is incomplete or corrupt (${which}).`);
  }
};

/**
 * Rejects unless both finished meshes of a done job are valid GLBs.
 * @param {{displayMeshUri: string|null, meshUri: string|null}} uris - Finished mesh URIs.
 * @returns {Promise<void>} Resolves when both files check out.
 */
export const assertValidJobMeshes = async ({ displayMeshUri, meshUri }) => {
  if (!displayMeshUri || !meshUri) {
    throw new Error("Model files are missing.");
  }
  await assertValidGlb(displayMeshUri, "display mesh");
  await assertValidGlb(meshUri, "full mesh");
};

const writeModelCopy = async (displayMeshUri) => {
  const outputDirectory = new Directory(Paths.cache, OUTPUT_DIRECTORY_NAME);
  if (!outputDirectory.exists) {
    outputDirectory.create({ intermediates: true, idempotent: true });
  }
  const modelFile = new File(outputDirectory, `${randomUUID()}.glb`);
  await new File(displayMeshUri).copy(modelFile);
  return modelFile;
};

/**
 * Copies an already-finished job's display mesh into the cache for the
 * caller to move (resume-after-return/relaunch path in the hook).
 * @param {string} displayMeshUri - Finished display mesh file URI.
 * @returns {Promise<{uri: string, format: string}>} The model reference.
 */
export const copyCompletedDisplayMesh = async (displayMeshUri) => {
  const modelFile = await writeModelCopy(displayMeshUri);
  return {
    uri: modelFile.uri,
    format: GENERATED_SHAPE_MODEL_FORMATS.GLB,
  };
};

// Best-effort record cleanup after an in-session terminal outcome (the
// relaunch path only matters when the process died before this ran).
const forgetJob = (jobId) => {
  clearJob(jobId).catch(() => {});
};

// Bridges one job's events into a port-style promise. Shared by convert
// (fresh job) and attachToTripoSGJob (resumed job): resolves the display
// mesh URI, rejects cancelled/failed, and cleans up on abort.
const waitForJob = ({ jobId, steps, onProgress, signal }) =>
  new Promise((resolve, reject) => {
    const subscriptions = [];
    const stopListening = () =>
      subscriptions.splice(0).forEach((sub) => sub.remove());

    const onAbort = () => {
      Promise.resolve()
        .then(() => cancel(jobId))
        .catch(() => {});
    };
    signal?.addEventListener("abort", onAbort);

    const done = (fn) => {
      signal?.removeEventListener("abort", onAbort);
      stopListening();
      fn();
    };
    subscriptions.push(
      addProgressListener((event) => {
        if (event.jobId !== jobId) return;
        onProgress?.({
          fraction: event.fraction,
          label: labelFor(event.label, event.fraction, steps),
        });
      }),
      addDoneListener((event) => {
        if (event.jobId !== jobId) return;
        // A done event with broken outputs (should not happen: the engine
        // renames temp files only on success) still fails loudly instead
        // of saving a streaky mesh.
        assertValidJobMeshes(event).then(
          () => done(() => resolve(event.displayMeshUri)),
          (err) => done(() => reject(err)),
        );
      }),
      addErrorListener((event) => {
        if (event.jobId !== jobId) return;
        if (event.code === "cancelled" || signal?.aborted) {
          done(() => reject(new ImageTo3dCancelledError()));
        } else {
          done(() => reject(new Error(event.message || "On-device conversion failed.")));
        }
      }),
    );
    if (signal?.aborted) {
      onAbort();
      done(() => reject(new ImageTo3dCancelledError()));
    }
  });

const checkReady = async () => {
  let status;
  try {
    status = await getStatus();
  } catch (err) {
    throw new ImageTo3dUnavailableError(
      "unsupported",
      "On-device 3D needs the Android app on a Snapdragon 8 Elite phone.",
    );
  }
  if (!status.supported) {
    throw new ImageTo3dUnavailableError(
      "unsupported",
      `On-device 3D isn't available: ${status.reason ?? "unsupported device"}.`,
    );
  }
  if (!status.modelsVerified) {
    throw new ImageTo3dUnavailableError(
      "models-missing",
      "Download the TripoSG models below first (or sideload them, then Verify).",
    );
  }
};

/** @type {import("../domain/image-to-3d.port").ImageTo3dPort} */
export const triposgImageTo3dAdapter = {
  convertImageTo3d: async ({ image, onProgress, signal }) => {
    if (Platform.OS !== "android") {
      throw new ImageTo3dUnavailableError(
        "unsupported",
        "On-device 3D needs the Android app on a Snapdragon 8 Elite phone.",
      );
    }
    if (!image?.uri) throw new Error("Choose an image to convert.");
    throwIfCancelled(signal);
    await checkReady();

    const steps = 50;
    let jobId;
    try {
      jobId = await convert({
        imageUri: image.uri,
        fileName: image.fileName ?? null,
        imageWidth: image.width,
        imageHeight: image.height,
        steps,
      });
    } catch (err) {
      // Lost race with a delete between checkReady and convert.
      if (/no models|models incomplete/i.test(err?.message ?? "")) {
        throw new ImageTo3dUnavailableError(
          "models-missing",
          "Download the TripoSG models below first (or sideload them, then Verify).",
        );
      }
      throw err;
    }
    let modelFile = null;
    try {
      const displayMeshUri = await waitForJob({ jobId, steps, onProgress, signal });
      throwIfCancelled(signal);
      modelFile = await writeModelCopy(displayMeshUri);
      if (signal?.aborted) {
        if (modelFile.exists) modelFile.delete();
        throw new ImageTo3dCancelledError();
      }
      return {
        model: {
          uri: modelFile.uri,
          format: GENERATED_SHAPE_MODEL_FORMATS.GLB,
        },
        generator: GENERATOR_ID,
      };
    } catch (err) {
      if (modelFile?.exists) modelFile.delete();
      if (signal?.aborted || err instanceof ImageTo3dCancelledError) {
        throw new ImageTo3dCancelledError();
      }
      throw err;
    } finally {
      forgetJob(jobId);
    }
  },
};

/**
 * Reattaches to a still-running persisted job (return/relaunch resume in
 * the hook): same event bridge as convert, without starting anything.
 * @param {{jobId: string, steps: number, onProgress: function(object): void, signal: AbortSignal}} request - Job to follow.
 * @returns {Promise<{model: {uri: string, format: string}, generator: string}>} The finished model.
 */
export const attachToTripoSGJob = async ({ jobId, steps, onProgress, signal }) => {
  throwIfCancelled(signal);
  let modelFile = null;
  try {
    const displayMeshUri = await waitForJob({ jobId, steps, onProgress, signal });
    throwIfCancelled(signal);
    modelFile = await writeModelCopy(displayMeshUri);
    if (signal?.aborted) {
      if (modelFile.exists) modelFile.delete();
      throw new ImageTo3dCancelledError();
    }
    return {
      model: {
        uri: modelFile.uri,
        format: GENERATED_SHAPE_MODEL_FORMATS.GLB,
      },
      generator: GENERATOR_ID,
    };
  } catch (err) {
    if (modelFile?.exists) modelFile.delete();
    if (signal?.aborted || err instanceof ImageTo3dCancelledError) {
      throw new ImageTo3dCancelledError();
    }
    throw err;
  } finally {
    forgetJob(jobId);
  }
};
