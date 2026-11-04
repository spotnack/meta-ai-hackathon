import { Platform } from "react-native";
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { GENERATED_SHAPE_MODEL_FORMATS } from "@features/generated-shapes/domain/generated-shapes.entity";

import { ImageTo3dCancelledError } from "../domain/image-to-3d-conversion.entity";
import {
  DEMO_GENERATOR_ID,
  DEMO_MESH_LOAD_MESSAGE,
  DEMO_MESH_MODULES,
} from "./demo-goldens.config";

/*
Infrastructure adapter implementing ImageTo3dPort (image-to-3d.port.js) for
the hackathon demo: it serves the bundled display mesh
(demo-goldens/<id>/mesh.display.glb, ~80k faces decimated from the
cloud-GPU original) matching the selected pre-cut golden input, instead of
running inference. Progress, cancellation and cleanup follow
placeholder-image-to-3d.adapter.js so the rest of the workflow is exercised
unchanged. The bundled file is copied into the cache because the caller
takes ownership of the resolved model file and moves it.
*/

const OUTPUT_DIRECTORY_NAME = "image-to-3d";

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw new ImageTo3dCancelledError();
};

/** @type {import("../domain/image-to-3d.port").ImageTo3dPort} */
export const demoGoldensImageTo3dAdapter = {
  convertImageTo3d: async ({ image, onProgress, signal }) => {
    if (Platform.OS === "web") {
      throw new Error("Image-to-3D conversion requires the iOS or Android app.");
    }
    const meshModule = image?.demoGoldenId
      ? DEMO_MESH_MODULES[image.demoGoldenId]
      : null;
    if (!meshModule) {
      throw new Error("Pick a demo golden input first.");
    }
    throwIfCancelled(signal);

    const outputDirectory = new Directory(Paths.cache, OUTPUT_DIRECTORY_NAME);
    if (!outputDirectory.exists) {
      outputDirectory.create({ intermediates: true, idempotent: true });
    }
    const modelFile = new File(outputDirectory, `${randomUUID()}.glb`);

    onProgress?.({ fraction: 0.2, label: "Loading demo mesh" });
    try {
      const [asset] = await Asset.loadAsync(meshModule);
      throwIfCancelled(signal);
      if (!asset?.localUri) throw new Error(DEMO_MESH_LOAD_MESSAGE);
      await new File(asset.localUri).copy(modelFile);
    } catch (err) {
      if (modelFile.exists) modelFile.delete();
      if (
        signal?.aborted ||
        err instanceof ImageTo3dCancelledError ||
        err?.name === "AbortError"
      ) {
        throw new ImageTo3dCancelledError();
      }
      throw new Error(DEMO_MESH_LOAD_MESSAGE);
    }
    if (signal?.aborted) {
      if (modelFile.exists) modelFile.delete();
      throw new ImageTo3dCancelledError();
    }

    onProgress?.({ fraction: 1, label: "Done" });
    return {
      model: {
        uri: modelFile.uri,
        format: GENERATED_SHAPE_MODEL_FORMATS.GLB,
      },
      generator: DEMO_GENERATOR_ID,
    };
  },
};
