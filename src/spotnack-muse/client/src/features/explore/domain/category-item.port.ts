// Model layer: includes ports (interfaces).
// This is the contract `search-keyword.utils.ts`'s `isValidCategoryItem` validates against and
// `explore-card.component.jsx` renders. Kept here as living documentation of the shape,
// not an enforced runtime type. This codebase has notype-checking build step.
// The JSDoc typedef is for editor/IDE hinting.

/**
 * @file Domain shape for an explorable listing in the Explore feed.
 * @typedef {object} CategoryItem
 * @property {string} id - Unique identifier.
 * @property {string} name - Display name.
 * @property {string[]} thumbnail - Thumbnail URIs, always an array (never undefined).
 * @property {number} [bookmarkCount] - Mutated in place by the favourites feature.
 * @property {string|null} [generator] - Pipeline that produced the model, for generated items.
 * @property {string|null} [demoAttribution] - Honest cloud-GPU label for demo assets; null otherwise.
 */

export {};
