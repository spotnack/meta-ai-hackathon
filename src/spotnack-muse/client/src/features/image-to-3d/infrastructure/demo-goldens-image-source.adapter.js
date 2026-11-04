import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";

import {
  DEMO_GOLDEN_IDS,
  DEMO_INPUT_LOAD_MESSAGE,
  DEMO_INPUT_MODULES,
} from "./demo-goldens.config";

/*
Infrastructure adapter implementing ImageSourcePort (image-to-3d.port.js)
for the hackathon demo: instead of the photo library, each tap selects the
next of the 5 pre-cut golden inputs (round-robin), copied from the app
bundle to the cache. The returned image carries demoGoldenId so the demo
conversion adapter can fetch the matching bundled mesh.glb. Fully offline.
*/

const OUTPUT_DIRECTORY_NAME = "demo-goldens";

// Round-robin cursor across taps. Module state is fine for a demo picker:
// the Change button cycles to the next golden input.
let nextGoldenIndex = 0;

/** @type {import("../domain/image-to-3d.port").ImageSourcePort} */
export const demoGoldensImageSourceAdapter = {
  pickImage: async () => {
    const id = DEMO_GOLDEN_IDS[nextGoldenIndex % DEMO_GOLDEN_IDS.length];
    nextGoldenIndex += 1;

    const outputDirectory = new Directory(Paths.cache, OUTPUT_DIRECTORY_NAME);
    if (!outputDirectory.exists) {
      outputDirectory.create({ intermediates: true, idempotent: true });
    }
    const imageFile = new File(outputDirectory, `${id}.png`);

    try {
      const asset = Asset.fromModule(DEMO_INPUT_MODULES[id]);
      // Android release builds keep bundled images as drawable resources:
      // expo-asset marks them downloaded with a bare resource name as
      // localUri, which File cannot open. Force a real copy to the cache.
      if (asset.localUri && !asset.localUri.includes("://")) {
        asset.downloaded = false;
        asset.localUri = null;
      }
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error(DEMO_INPUT_LOAD_MESSAGE);
      // The round-robin revisits each id, so replace the previous copy.
      await new File(asset.localUri).copy(imageFile, { overwrite: true });
    } catch {
      throw new Error(DEMO_INPUT_LOAD_MESSAGE);
    }
    if (!imageFile.exists) throw new Error(DEMO_INPUT_LOAD_MESSAGE);

    return {
      uri: imageFile.uri,
      width: 512,
      height: 512,
      fileName: `${id}.png`,
      mimeType: "image/png",
      demoGoldenId: id,
    };
  },
};
