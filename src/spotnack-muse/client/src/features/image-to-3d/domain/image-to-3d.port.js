/**
 * @file Ports (contracts) for the image-to-3D workflow.
 *
 * ImageTo3dPort is satisfied today by placeholder-image-to-3d.adapter.js, which simulates
 * the pipeline without running inference. The on-device AI pipeline (docs/ai_pipeline.md)
 * plugs in by implementing the same contract and swapping the adapter in
 * use-image-to-3d-conversion.hook.js - nothing above that hook changes.
 *
 * ImageSourcePort is satisfied by image-library.adapter.js (the device photo library).
 * @typedef {object} ImageTo3dPort
 * @property {(request: ImageTo3dRequest) => Promise<ImageTo3dResult>} convertImageTo3d - Generate a 3D model from one image.
 */

/**
 * @typedef {object} ImageTo3dRequest
 * @property {SelectedImage} image - The image to convert.
 * @property {(progress: ImageTo3dProgress) => void} [onProgress] - Called as the pipeline advances.
 * @property {AbortSignal} [signal] - Aborted when the user stops the conversion. The pipeline must then stop
 * as soon as it can, delete any temporary output, and reject with ImageTo3dCancelledError
 * (image-to-3d-conversion.entity.js) instead of resolving.
 */

/**
 * @typedef {object} ImageTo3dProgress
 * @property {number} fraction - Overall completion from 0 to 1.
 * @property {string} label - Human-readable name of the current stage.
 */

/**
 * @typedef {object} ImageTo3dResult
 * @property {import("@features/generated-shapes/domain/generated-shapes.entity").GeneratedShapeModel} model - A temporary
 * model file. The caller takes ownership and moves it into permanent storage.
 * @property {string} generator - Identifier of the pipeline (and version) that produced the model.
 */

/**
 * @typedef {object} ImageSourcePort
 * @property {() => Promise<SelectedImage|null>} pickImage - Let the user choose an image. Resolves null when they cancel,
 * rejects with ImagePermissionError when access is denied.
 */

/**
 * @typedef {object} SelectedImage
 * @property {string} uri - Local file URI.
 * @property {number} width - Pixel width.
 * @property {number} height - Pixel height.
 * @property {string|null} fileName - Original file name, when the platform reports it.
 * @property {string|null} mimeType - MIME type, when the platform reports it.
 */

export {};
