import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { GENERATED_SHAPE_MODEL_FORMATS } from "@features/generated-shapes/domain/generated-shapes.entity";

import { ImageTo3dCancelledError } from "../domain/image-to-3d-conversion.entity";

/*
Infrastructure adapter implementing ImageTo3dPort (image-to-3d.port.js) WITHOUT running any AI inference.
It walks through the stages a real pipeline reports, then writes a small JSON descriptor in place of a model file,
so the UI, progress reporting, cancellation and asset storage are exercised end to end.

To integrate the real pipeline, implement convertImageTo3d with the same signature: report progress through
onProgress, stop when `signal` aborts (deleting temporary output and rejecting with ImageTo3dCancelledError),
write the generated model (e.g. a .glb) to a temporary file, and resolve { model: { uri, format }, generator }.
*/

const GENERATOR_ID = "placeholder-image-to-3d@1";
const OUTPUT_DIRECTORY_NAME = "image-to-3d";
const TICK_MS = 100;

const SIMULATED_STAGES = [
  { label: "Preparing image", durationMs: 600 },
  { label: "Isolating subject", durationMs: 800 },
  { label: "Generating geometry", durationMs: 1400 },
  { label: "Packaging model", durationMs: 500 },
];

const TOTAL_DURATION_MS = SIMULATED_STAGES.reduce(
  (total, stage) => total + stage.durationMs,
  0,
);

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw new ImageTo3dCancelledError();
};

// Resolves after `ms`, or rejects as soon as `signal` aborts, so stopping takes effect immediately.
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ImageTo3dCancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ImageTo3dCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
  });

const simulateStages = async (onProgress, signal) => {
  let elapsedMs = 0;
  for (const stage of SIMULATED_STAGES) {
    for (let stageMs = 0; stageMs < stage.durationMs; stageMs += TICK_MS) {
      onProgress?.({ fraction: elapsedMs / TOTAL_DURATION_MS, label: stage.label });
      await wait(TICK_MS, signal);
      elapsedMs += TICK_MS;
    }
  }
  onProgress?.({ fraction: 1, label: "Done" });
};

const writePlaceholderModel = async (image) => {
  const outputDirectory = new Directory(Paths.cache, OUTPUT_DIRECTORY_NAME);
  if (!outputDirectory.exists) {
    outputDirectory.create({ intermediates: true, idempotent: true });
  }

  const modelFile = new File(outputDirectory, `${randomUUID()}.placeholder.json`);
  await modelFile.write(
    JSON.stringify(
      {
        format: GENERATED_SHAPE_MODEL_FORMATS.PLACEHOLDER,
        generator: GENERATOR_ID,
        note: "Placeholder for a generated 3D model. No AI inference was run.",
        createdAt: new Date().toISOString(),
        source: { width: image.width, height: image.height },
      },
      null,
      2,
    ),
  );
  return modelFile;
};

/** @type {import("../domain/image-to-3d.port").ImageTo3dPort} */
export const placeholderImageTo3dAdapter = {
  convertImageTo3d: async ({ image, onProgress, signal }) => {
    if (Platform.OS === "web") {
      throw new Error("Image-to-3D conversion requires the iOS or Android app.");
    }
    if (!image?.uri) throw new Error("Choose an image to convert.");
    throwIfCancelled(signal);

    await simulateStages(onProgress, signal);
    throwIfCancelled(signal);
    const modelFile = await writePlaceholderModel(image);

    // Stopped while the file was being written: the caller never sees it, so clean it up here.
    if (signal?.aborted) {
      if (modelFile.exists) modelFile.delete();
      throw new ImageTo3dCancelledError();
    }

    return {
      model: {
        uri: modelFile.uri,
        format: GENERATED_SHAPE_MODEL_FORMATS.PLACEHOLDER,
      },
      generator: GENERATOR_ID,
    };
  },
};
