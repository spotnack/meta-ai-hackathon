/**
 * @file Domain shape and rules for the GeneratedShape entity managed by this
 * feature's CRUD flows. Mirrors the server's authoritative Joi schema
 * (server/src/middlewares/generated-shape.middleware.js) so the create/edit form
 * can show sane defaults and reject obviously-invalid input before a round
 * trip - the server remains the single source of truth for validation, this
 * is a UX convenience only.
 * @typedef {object} GeneratedShape
 * @property {number|string} id - Assigned by the persistence adapter, never set by the client.
 * @property {string} [ownerId] - Id of the user who created the shape; only they may rename or delete it.
 * @property {string} name - Display name.
 * @property {string} description - Free-text description.
 * @property {string} image - A URL; empty string when there is no photo. For shapes generated
 * on-device this is the source image the shape was generated from.
 * @property {number} rating - 0-5.
 * @property {number} reviewCount - Non-negative integer.
 * @property {Array<{id: number, name: string}>} assets - Named sub-items.
 * @property {string} [createdAt] - ISO-8601 creation timestamp.
 * @property {GeneratedShapeModel|null} [model] - The 3D model file, or null when it is missing.
 * @property {string|null} [generator] - Identifier of the pipeline that produced the model.
 * @property {{uri: string|null, saveUri: string}} [preview] - Still image of the model (uri, null until saved) and where to save it.
 */

/**
 * @typedef {object} GeneratedShapeModel
 * @property {string} uri - Local file URI of the model.
 * @property {string} format - One of GENERATED_SHAPE_MODEL_FORMATS.
 */

// Mirrors the server's createSchema defaults (generated-shape.middleware.js).
export const DEFAULT_GENERATED_SHAPE_FIELDS = {
  name: "New Generated Shape",
  description: "New Generated Shape Description",
  image: "",
  rating: 0,
  reviewCount: 0,
};

export const GENERATED_SHAPE_NAME_MAX_LENGTH = 200;
export const GENERATED_SHAPE_RATING_MIN = 0;
export const GENERATED_SHAPE_RATING_MAX = 5;

// "placeholder" marks the stand-in model written while the image-to-3D AI
// pipeline is not integrated. Real pipeline output (e.g. "glb") is rendered by
// the 3D viewer instead of the placeholder preview.
export const GENERATED_SHAPE_MODEL_FORMATS = Object.freeze({
  GLB: "glb",
  PLACEHOLDER: "placeholder",
});

const RENDERABLE_MODEL_FORMATS = [GENERATED_SHAPE_MODEL_FORMATS.GLB];

const UNTITLED_GENERATED_SHAPE_NAME = "Untitled 3D asset";

/**
 * Mirrors the server's `name` rule (trimmed, 1-200 chars) so the form can
 * disable submission client-side. Not a substitute for server validation.
 * @param {string} name - Candidate generated shape name.
 * @returns {boolean} Whether the name would pass the server's schema.
 */
export const isGeneratedShapeNameValid = (name) =>
  typeof name === "string" &&
  name.trim().length > 0 &&
  name.trim().length <= GENERATED_SHAPE_NAME_MAX_LENGTH;

/**
 * Mirrors the server's `rating` rule (0-5). Undefined/empty is treated as
 * valid since rating is optional on both create and update.
 * @param {number|string|undefined} rating - Candidate rating value.
 * @returns {boolean} Whether the rating would pass the server's schema.
 */
export const isGeneratedShapeRatingValid = (rating) => {
  if (rating == null || rating === "") return true;
  const numericRating = Number(rating);
  return (
    !Number.isNaN(numericRating) &&
    numericRating >= GENERATED_SHAPE_RATING_MIN &&
    numericRating <= GENERATED_SHAPE_RATING_MAX
  );
};

/**
 * Whether a model can be shown in the 3D viewer (as opposed to the placeholder preview).
 * @param {GeneratedShapeModel|null|undefined} model - Candidate model.
 * @returns {boolean} True for an existing model file in a renderable format.
 */
export const isRenderableGeneratedShapeModel = (model) =>
  Boolean(model?.uri) && RENDERABLE_MODEL_FORMATS.includes(model.format);

/**
 * Derives a display name from the source image's file name (e.g. "IMG_0042.jpg" -> "IMG_0042").
 * @param {string|null|undefined} sourceFileName - File name reported by the image picker, if any.
 * @returns {string} A name that passes isGeneratedShapeNameValid.
 */
export const buildGeneratedShapeName = (sourceFileName) => {
  const baseName =
    typeof sourceFileName === "string"
      ? sourceFileName.replace(/\.[^./]+$/, "").trim()
      : "";
  return (baseName || UNTITLED_GENERATED_SHAPE_NAME).slice(
    0,
    GENERATED_SHAPE_NAME_MAX_LENGTH,
  );
};

/**
 * Orders shapes newest first. Shapes without a timestamp sort last.
 * @param {GeneratedShape} a - First shape.
 * @param {GeneratedShape} b - Second shape.
 * @returns {number} Sort comparator result.
 */
export const compareGeneratedShapesNewestFirst = (a, b) =>
  (Date.parse(b?.createdAt) || 0) - (Date.parse(a?.createdAt) || 0);
