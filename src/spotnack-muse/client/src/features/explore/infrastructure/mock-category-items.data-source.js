import { mockData } from "./mock-category-items.mock.json";
import { Image } from "react-native";

// Map mock "S3 keys" to bundled .glb assets so the app can resolve a URI at runtime.
const mockS3BucketAssetMap = {
  "./mockS3Bucket/Avocado_Slice_Avocado_0.glb": require("./mock-category-items/food/Avocado_Slice_Avocado_0.glb"),
  "./mockS3Bucket/Bread_Slice_Bread_0.glb": require("./mock-category-items/food/Bread_Slice_Bread_0.glb"),
  "./mockS3Bucket/Cheese_Slice_Cheese_0.glb": require("./mock-category-items/food/Cheese_Slice_Cheese_0.glb"),
  "./mockS3Bucket/Cucumber_Slice_Cucumber_0.glb": require("./mock-category-items/food/Cucumber_Slice_Cucumber_0.glb"),
  "./mockS3Bucket/Egg_Slice_Egg_0.glb": require("./mock-category-items/food/Egg_Slice_Egg_0.glb"),
  "./mockS3Bucket/Fries_Slice_Fries_0.glb": require("./mock-category-items/food/Fries_Slice_Fries_0.glb"),
  "./mockS3Bucket/Halloumi_Slice_Halloumi_0.glb": require("./mock-category-items/food/Halloumi_Slice_Halloumi_0.glb"),
  "./mockS3Bucket/Ketchup_Slice_Ketchup_0.glb": require("./mock-category-items/food/Ketchup_Slice_Ketchup_0.glb"),
  "./mockS3Bucket/Lettuce_Slice_Lettuce_0.glb": require("./mock-category-items/food/Lettuce_Slice_Lettuce_0.glb"),
  "./mockS3Bucket/Mayo_Slice_Mayo_0.glb": require("./mock-category-items/food/Mayo_Slice_Mayo_0.glb"),
  "./mockS3Bucket/Melted_Butter_Butter_0.glb": require("./mock-category-items/food/Melted_Butter_Butter_0.glb"),
  "./mockS3Bucket/Mushroom_Slice_Mushroom_0.glb": require("./mock-category-items/food/Mushroom_Slice_Mushroom_0.glb"),
  "./mockS3Bucket/Mustard_Slice_Mustrard_0.glb": require("./mock-category-items/food/Mustard_Slice_Mustrard_0.glb"),
  "./mockS3Bucket/Olive_Slice_Oilives_0.glb": require("./mock-category-items/food/Olive_Slice_Oilives_0.glb"),
  "./mockS3Bucket/Onion_Slice_Onion_0.glb": require("./mock-category-items/food/Onion_Slice_Onion_0.glb"),
  "./mockS3Bucket/Pepper_Slice_Pepper_0.glb": require("./mock-category-items/food/Pepper_Slice_Pepper_0.glb"),
  "./mockS3Bucket/Pickle_Slice_Pickles_0.glb": require("./mock-category-items/food/Pickle_Slice_Pickles_0.glb"),
  "./mockS3Bucket/Pineapple_Slice_Pineapple_0.glb": require("./mock-category-items/food/Pineapple_Slice_Pineapple_0.glb"),
  "./mockS3Bucket/Qiiwi_Slice_Qiiwi_0.glb": require("./mock-category-items/food/Qiiwi_Slice_Qiiwi_0.glb"),
  "./mockS3Bucket/Tomato_Slice_Tomato_0.glb": require("./mock-category-items/food/Tomato_Slice_Tomato_0.glb"),
  "./mockS3Bucket/Waffle_Slice_Waffle_0.glb": require("./mock-category-items/food/Waffle_Slice_Waffle_0.glb"),
};

// Still image of each model (tools/model-previews/render_previews.py renders
// them with the Explore card's scene). Cards show it when they cannot hold
// a live 3D view (lease cap, or a conversion running).
const mockS3BucketPreviewMap = {
  "./mockS3Bucket/Avocado_Slice_Avocado_0.glb": require("./mock-category-items/food/Avocado_Slice_Avocado_0.png"),
  "./mockS3Bucket/Bread_Slice_Bread_0.glb": require("./mock-category-items/food/Bread_Slice_Bread_0.png"),
  "./mockS3Bucket/Cheese_Slice_Cheese_0.glb": require("./mock-category-items/food/Cheese_Slice_Cheese_0.png"),
  "./mockS3Bucket/Cucumber_Slice_Cucumber_0.glb": require("./mock-category-items/food/Cucumber_Slice_Cucumber_0.png"),
  "./mockS3Bucket/Egg_Slice_Egg_0.glb": require("./mock-category-items/food/Egg_Slice_Egg_0.png"),
  "./mockS3Bucket/Fries_Slice_Fries_0.glb": require("./mock-category-items/food/Fries_Slice_Fries_0.png"),
  "./mockS3Bucket/Halloumi_Slice_Halloumi_0.glb": require("./mock-category-items/food/Halloumi_Slice_Halloumi_0.png"),
  "./mockS3Bucket/Ketchup_Slice_Ketchup_0.glb": require("./mock-category-items/food/Ketchup_Slice_Ketchup_0.png"),
  "./mockS3Bucket/Lettuce_Slice_Lettuce_0.glb": require("./mock-category-items/food/Lettuce_Slice_Lettuce_0.png"),
  "./mockS3Bucket/Mayo_Slice_Mayo_0.glb": require("./mock-category-items/food/Mayo_Slice_Mayo_0.png"),
  "./mockS3Bucket/Melted_Butter_Butter_0.glb": require("./mock-category-items/food/Melted_Butter_Butter_0.png"),
  "./mockS3Bucket/Mushroom_Slice_Mushroom_0.glb": require("./mock-category-items/food/Mushroom_Slice_Mushroom_0.png"),
  "./mockS3Bucket/Mustard_Slice_Mustrard_0.glb": require("./mock-category-items/food/Mustard_Slice_Mustrard_0.png"),
  "./mockS3Bucket/Olive_Slice_Oilives_0.glb": require("./mock-category-items/food/Olive_Slice_Oilives_0.png"),
  "./mockS3Bucket/Onion_Slice_Onion_0.glb": require("./mock-category-items/food/Onion_Slice_Onion_0.png"),
  "./mockS3Bucket/Pepper_Slice_Pepper_0.glb": require("./mock-category-items/food/Pepper_Slice_Pepper_0.png"),
  "./mockS3Bucket/Pickle_Slice_Pickles_0.glb": require("./mock-category-items/food/Pickle_Slice_Pickles_0.png"),
  "./mockS3Bucket/Pineapple_Slice_Pineapple_0.glb": require("./mock-category-items/food/Pineapple_Slice_Pineapple_0.png"),
  "./mockS3Bucket/Qiiwi_Slice_Qiiwi_0.glb": require("./mock-category-items/food/Qiiwi_Slice_Qiiwi_0.png"),
  "./mockS3Bucket/Tomato_Slice_Tomato_0.glb": require("./mock-category-items/food/Tomato_Slice_Tomato_0.png"),
  "./mockS3Bucket/Waffle_Slice_Waffle_0.glb": require("./mock-category-items/food/Waffle_Slice_Waffle_0.png"),
};

// Image.resolveAssetSource works for any Metro-bundled asset, not only images.
// It returns the URI the Metro dev server (or production bundle) serves the file at.
const resolveMockS3fileUri = (filePath) => {
  if (typeof filePath !== "string") return filePath;

  const assetModule = mockS3BucketAssetMap[filePath];
  if (!assetModule) return filePath;

  return Image.resolveAssetSource(assetModule)?.uri || filePath;
};

const normalizeCategoryDataThumbnails = (data) => {
  const normalizedData = {};

  Object.keys(data || {}).forEach((sectionKey) => {
    const sectionItems = data[sectionKey];
    if (!Array.isArray(sectionItems)) {
      normalizedData[sectionKey] = sectionItems;
      return;
    }

    normalizedData[sectionKey] = sectionItems.map((item) => {
      if (!Array.isArray(item?.thumbnail)) return item;

      const preview = mockS3BucketPreviewMap[item.thumbnail[0]];
      return {
        ...item,
        thumbnail: item.thumbnail.map(resolveMockS3fileUri),
        previewImage: preview
          ? Image.resolveAssetSource(preview)?.uri ?? null
          : null,
      };
    });
  });

  return normalizedData;
};

// Dummy categories Data:
export const categoryServerData = normalizeCategoryDataThumbnails(mockData);
