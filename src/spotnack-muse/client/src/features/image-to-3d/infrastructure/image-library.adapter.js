import * as ImagePicker from "expo-image-picker";

import { ImagePermissionError } from "../domain/image-to-3d-conversion.entity";

/*
Infrastructure adapter implementing ImageSourcePort (image-to-3d.port.js) with the device photo library.
This is the only file in the image-to-3d feature that knows expo-image-picker exists.
*/

const PICKER_OPTIONS = {
  mediaTypes: ["images"],
  allowsEditing: false,
  allowsMultipleSelection: false,
  quality: 1,
  exif: false,
};

const launchLibrary = () => ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

const requestLibraryPermission = async () => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ImagePermissionError(permission.canAskAgain);
  }
};

/** @type {import("../domain/image-to-3d.port").ImageSourcePort} */
export const imageLibraryAdapter = {
  pickImage: async () => {
    let result;
    try {
      // The system photo picker needs no runtime permission on current iOS/Android, so the
      // prompt is only shown on the older OS versions where launching without it fails.
      result = await launchLibrary();
    } catch {
      await requestLibraryPermission();
      result = await launchLibrary();
    }

    if (result.canceled || !result.assets?.length) return null;

    const [asset] = result.assets;
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileName: asset.fileName ?? null,
      mimeType: asset.mimeType ?? null,
    };
  },
};
