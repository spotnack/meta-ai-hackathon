/**
 * @file Port (contract) for generated shapes persistence, satisfied today by
 * generated-shapes.file-system.adapter.js (on-device storage via expo-file-system).
 * A port instance serves one user: every method only sees and changes that user's shapes.
 * generated-shapes.api.adapter.js (a fetch-based HTTP client against the Express
 * backend) satisfies the same contract for when the server exposes the route.
 * Application code (use-generated-shapes.hook.js) depends on this
 * shape, not on `fetch`, the file system or any particular backend - swapping the adapter
 * (e.g. for a test double, or a future GraphQL client) requires no change
 * above this layer.
 * @typedef {object} GeneratedShapesPort
 * @property {() => Promise<import("./generated-shapes.entity").GeneratedShape[]>} listGeneratedShapes - Fetch every generated shape, newest first.
 * @property {(id: number|string) => Promise<import("./generated-shapes.entity").GeneratedShape>} getGeneratedShape - Fetch one generated shape.
 * @property {(fields: GeneratedShapeDraft) => Promise<import("./generated-shapes.entity").GeneratedShape>} createGeneratedShape - Create a generated shape.
 * @property {(id: number|string, fields: object) => Promise<import("./generated-shapes.entity").GeneratedShape>} updateGeneratedShape - Patch a generated shape.
 * @property {(id: number|string) => Promise<{id: number|string, message: string}>} deleteGeneratedShape - Delete a generated shape and every file it owns.
 */

/**
 * @typedef {object} GeneratedShapeDraft
 * @property {string} [name] - Display name.
 * @property {string} [description] - Free-text description.
 * @property {string} [sourceImageUri] - Local URI of the image the shape was generated from.
 * The adapter copies it, so the original may be a temporary file.
 * @property {import("./generated-shapes.entity").GeneratedShapeModel} model - The model file produced
 * by the image-to-3D pipeline. Ownership passes to the adapter, which moves it into storage.
 * @property {string} [generator] - Identifier of the pipeline that produced the model.
 */

export {};
