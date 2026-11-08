import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  randomUUID,
} from "expo-crypto";

import {
  DEFAULT_GENERATED_SHAPE_FIELDS,
  GENERATED_SHAPE_MODEL_FORMATS,
  buildGeneratedShapeName,
  compareGeneratedShapesNewestFirst,
  isGeneratedShapeNameValid,
} from "../domain/generated-shapes.entity";

/*
Infrastructure adapter implementing generated-shapes.port.js against the device's local file system.
This is the only file in the generated-shapes feature that knows where (and how) shapes are stored.

Shapes are private to the user who created them: each adapter instance is bound to one owner and can only
reach that owner's directory, so another user's shapes can't be listed, read, renamed or deleted, even by id.
Each shape owns one directory, so deleting a shape removes its model, source image and metadata together:

  <documents>/generated-assets/users/
  └── <SHA-256 of the owner's user id>/   # Hashed: the id comes from the server, the hash is always a safe path segment.
      └── <id>/
          ├── source.<ext>             # Copy of the image the shape was generated from.
          ├── model.<ext>              # The 3D model: model.glb (on-device TripoSG) or model.placeholder.json.
          ├── preview.png              # Optional still of the model, saved by Explore after its first live render.
          └── metadata.json            # Written last. A directory without it is an interrupted write and is skipped.

metadata.json stores file names, never absolute URIs: iOS moves the app container on every update/reinstall,
so URIs are resolved against the current documents directory on each read.
*/

const ROOT_DIRECTORY_NAME = "generated-assets";
const USERS_DIRECTORY_NAME = "users";
const METADATA_FILE_NAME = "metadata.json";
const PREVIEW_FILE_NAME = "preview.png";
const METADATA_SCHEMA_VERSION = 1;
const SOURCE_IMAGE_BASE_NAME = "source";
const MODEL_BASE_NAME = "model";
const DEFAULT_IMAGE_EXTENSION = ".jpg";

const MODEL_FILE_EXTENSIONS = {
  [GENERATED_SHAPE_MODEL_FORMATS.GLB]: ".glb",
  [GENERATED_SHAPE_MODEL_FORMATS.PLACEHOLDER]: ".placeholder.json",
};

// Shape ids double as directory names, so only accept the characters randomUUID() produces.
const SHAPE_ID_PATTERN = /^[A-Za-z0-9-]+$/;

const assertFileSystemAvailable = () => {
  if (Platform.OS === "web") {
    throw new Error("Saving 3D assets requires the iOS or Android app.");
  }
};

const assertShapeId = (id) => {
  if (!SHAPE_ID_PATTERN.test(String(id))) {
    throw new Error(`Invalid generated shape id: ${id}`);
  }
};

const ensureDirectory = (directory) => {
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
};

const isMetadataValid = (metadata) =>
  Boolean(metadata) &&
  typeof metadata === "object" &&
  isGeneratedShapeNameValid(metadata.name) &&
  typeof metadata.createdAt === "string" &&
  (metadata.modelFile === null || typeof metadata.modelFile === "string") &&
  (metadata.imageFile === null || typeof metadata.imageFile === "string");

const resolveExistingFileUri = (directory, fileName) => {
  if (!fileName) return null;
  const file = new File(directory, fileName);
  return file.exists ? file.uri : null;
};

// Maps persisted metadata to the domain entity. Missing files degrade to "no image"/"no model"
// instead of dropping the shape, so the user can still see and delete it.
const toGeneratedShape = (directory, metadata, ownerId) => {
  const modelUri = resolveExistingFileUri(directory, metadata.modelFile);
  const previewFile = new File(directory, PREVIEW_FILE_NAME);
  return {
    ...DEFAULT_GENERATED_SHAPE_FIELDS,
    id: directory.name,
    ownerId,
    name: metadata.name,
    description: metadata.description ?? "",
    image: resolveExistingFileUri(directory, metadata.imageFile) ?? "",
    createdAt: metadata.createdAt,
    generator: metadata.generator ?? null,
    model: modelUri ? { uri: modelUri, format: metadata.modelFormat } : null,
    // Still saved by the Explore card after the first live render; lives
    // in the shape directory, so deleting the shape deletes it too.
    preview: {
      uri: previewFile.exists ? previewFile.uri : null,
      saveUri: previewFile.uri,
    },
  };
};

const readMetadata = async (directory) => {
  const metadataFile = new File(directory, METADATA_FILE_NAME);
  if (!metadataFile.exists) return null;
  const metadata = JSON.parse(await metadataFile.text());
  return isMetadataValid(metadata) ? metadata : null;
};

const writeMetadata = (directory, metadata) =>
  new File(directory, METADATA_FILE_NAME).write(
    JSON.stringify(metadata, null, 2),
  );

const readShapeDirectory = async (directory, ownerId) => {
  try {
    const metadata = await readMetadata(directory);
    if (!metadata) {
      console.warn(
        `- Skipping generated shape without valid metadata: ${directory.uri}`,
      );
      return null;
    }
    return toGeneratedShape(directory, metadata, ownerId);
  } catch (err) {
    console.warn(
      `- Skipping unreadable generated shape ${directory.uri}: ${err}`,
    );
    return null;
  }
};

const getImageExtension = (uri) => {
  const extension = new File(uri).extension.toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(extension)
    ? extension
    : DEFAULT_IMAGE_EXTENSION;
};

const getModelExtension = (model) =>
  MODEL_FILE_EXTENSIONS[model.format] ?? new File(model.uri).extension;

/**
 * Creates a generated-shapes port bound to one user's private storage.
 * @param {string} ownerId - Id of the signed-in user who owns the shapes.
 * @returns {import("../domain/generated-shapes.port").GeneratedShapesPort} The owner's generated-shapes port.
 */
export const createGeneratedShapesFileSystemAdapter = (ownerId) => {
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    throw new Error("A signed-in user is required to store 3D assets.");
  }

  let ownerDirectoryName = null;

  const getOwnerDirectory = async () => {
    if (!ownerDirectoryName) {
      // Cached per adapter; a failed digest is retried on the next call.
      ownerDirectoryName = digestStringAsync(
        CryptoDigestAlgorithm.SHA256,
        ownerId,
      ).catch((err) => {
        ownerDirectoryName = null;
        throw err;
      });
    }
    return ensureDirectory(
      new Directory(
        Paths.document,
        ROOT_DIRECTORY_NAME,
        USERS_DIRECTORY_NAME,
        await ownerDirectoryName,
      ),
    );
  };

  const getShapeDirectory = async (id) => {
    assertShapeId(id);
    return new Directory(await getOwnerDirectory(), String(id));
  };

  return {
    listGeneratedShapes: async () => {
      // Nothing can have been stored where there is no file system, which is not an error.
      if (Platform.OS === "web") return [];

      const directories = (await getOwnerDirectory())
        .list()
        .filter((entry) => entry instanceof Directory);
      const shapes = await Promise.all(
        directories.map((directory) => readShapeDirectory(directory, ownerId)),
      );
      return shapes.filter(Boolean).sort(compareGeneratedShapesNewestFirst);
    },

    getGeneratedShape: async (id) => {
      assertFileSystemAvailable();
      const directory = await getShapeDirectory(id);
      const shape = directory.exists
        ? await readShapeDirectory(directory, ownerId)
        : null;
      if (!shape) throw new Error("Generated shape not found.");
      return shape;
    },

    createGeneratedShape: async ({
      name,
      description = "",
      sourceImageUri,
      model,
      generator = null,
    }) => {
      assertFileSystemAvailable();
      if (!model?.uri || !model?.format) {
        throw new Error("A generated model file is required.");
      }

      const directory = new Directory(await getOwnerDirectory(), randomUUID());
      directory.create();

      try {
        let imageFile = null;
        if (sourceImageUri) {
          imageFile = `${SOURCE_IMAGE_BASE_NAME}${getImageExtension(sourceImageUri)}`;
          await new File(sourceImageUri).copy(new File(directory, imageFile));
        }

        const modelFile = `${MODEL_BASE_NAME}${getModelExtension(model)}`;
        await new File(model.uri).move(new File(directory, modelFile));

        const metadata = {
          schemaVersion: METADATA_SCHEMA_VERSION,
          name: isGeneratedShapeNameValid(name)
            ? name.trim()
            : buildGeneratedShapeName(null),
          description,
          createdAt: new Date().toISOString(),
          generator,
          imageFile,
          modelFile,
          modelFormat: model.format,
        };
        await writeMetadata(directory, metadata);

        return toGeneratedShape(directory, metadata, ownerId);
      } catch (err) {
        // Never leave a half-written shape behind.
        if (directory.exists) directory.delete();
        throw err;
      }
    },

    updateGeneratedShape: async (id, fields) => {
      assertFileSystemAvailable();
      const directory = await getShapeDirectory(id);
      const metadata = directory.exists ? await readMetadata(directory) : null;
      if (!metadata) throw new Error("Generated shape not found.");

      const next = { ...metadata };
      if (fields?.name !== undefined) {
        if (!isGeneratedShapeNameValid(fields.name)) {
          throw new Error("Name must be between 1 and 200 characters.");
        }
        next.name = fields.name.trim();
      }
      if (fields?.description !== undefined) {
        next.description = String(fields.description);
      }

      await writeMetadata(directory, next);
      return toGeneratedShape(directory, next, ownerId);
    },

    deleteGeneratedShape: async (id) => {
      assertFileSystemAvailable();
      const directory = await getShapeDirectory(id);
      // Idempotent: a shape that is already gone counts as deleted.
      if (directory.exists) directory.delete();
      return { id, message: "Generated shape deleted." };
    },
  };
};
