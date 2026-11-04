// Model layer: includes utility functions for search keyword normalization and validation.

// Import the camelize function from the camelize package:
import camelize from "camelize";

// Normalization function:
export const toNormalize = (keyword: string): string => {
  /**
   * This function normalizes an input keyword by removing diacritical marks (accents),
   * converting it to lowercase, and trimming leading and trailing spaces.
   * @param {string} keyword - The keyword to transform.
   * @returns {string} - The transformed keyword.
   * @example
   * ```typescript
   * toNormalize("  Café de l'Opera  "); // Output: "cafe de l'opera"
   * ```
   */

  // Return an empty string if the keyword is undefined, null, or empty
  if (!keyword) {
    console.log("- No search keyword provided. Exiting toNormalize...");
    return "";
  }

  // Normalize the keyword, remove diacritical marks, convert to lowercase, and trim spaces
  return keyword
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
};

// Helper function to check if an object is a non-empty object literal:
export const isNonEmptyObject = (data) => {
  return (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data).length > 0
  );
};

// Helper function to validate keyword input:
export const isKeywordValid = (keyword) => {
  if (!keyword) {
    console.log("- No search keyword provided. Exiting searchRequest...");
    return false;
  }
  return true;
};

// Helper function to filter category items by keyword:
export const filterCategoryItemsByKeyword = (items, keyword) => {
  const transformedKeyword = toNormalize(keyword);
  return items.filter((category) => {
    const transformedName = toNormalize(category.name);
    return (
      transformedName.includes(transformedKeyword)
    );
  });
};

// The keyword that matches every item (the search context's default):
export const ALL_ITEMS_KEYWORD = "all";

// Helper function to filter a flat list of items by the applied search keyword:
export const filterItemsBySearchKeyword = (items, keyword) => {
  /**
   * Applies a search keyword to a list the same way the search adapter filters each category.
   * Like the adapter, a keyword that matches nothing falls back to showing items, but here
   * every item is kept instead of the adapter's top 20.
   * @param {Array} items - Items with a `name`.
   * @param {string} keyword - The applied search keyword.
   * @returns {Array} The matching items, or every item when none match.
   */
  if (!keyword || keyword === ALL_ITEMS_KEYWORD) return items;
  const matches = filterCategoryItemsByKeyword(items, keyword);
  return matches.length > 0 ? matches : items;
};

// Helper function to log validation errors:
const logValidationError = (message) => {
  console.log(
    `*** ${message} (in mock-search.adapter.ts). Removing item from array...`
  );
};

// Helper function to normalize object keys to camelCase:
const normalizeKeys = (obj) => {
  const normalizedObj = {};
  for (const [key, value] of Object.entries(obj)) {
    normalizedObj[camelize(key)] = value;
  }
  return normalizedObj;
};

// Main validation function:
export const isValidCategoryItem = (item) => {
  if (!isNonEmptyObject(item)) {
    logValidationError(
      "Invalid datatype for marked item in isValidCategoryItem function. Expected object literal."
    );
    return false;
  }

  const requiredProperties = {
    id: "string",
    name: "string",
    thumbnail: "array",
    bookmarkCount: "number",

  };

  const normalizedItem = normalizeKeys(item);

  for (const [key, expectedType] of Object.entries(requiredProperties)) {
    const actualType = Array.isArray(normalizedItem[key])
      ? "array"
      : typeof normalizedItem[key];
    if (actualType !== expectedType) {
      logValidationError(
        `Item property ${key} should be of type "${expectedType}" but is of type "${actualType}"`
      );
      return false;
    }
  }

  return true;
};