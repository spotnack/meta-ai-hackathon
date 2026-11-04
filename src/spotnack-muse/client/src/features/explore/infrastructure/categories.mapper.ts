/*
This file is reponsible for transforming the data from the search result.
*/

// Import the camelize function from the camelize package:
import camelize from "camelize";

// Define the CategoryTransform function:
export const CategoryTransform = (data: Object): Object => {
  /*
   * The CategoryTransform function is responsible for transforming the data from the search result.
   *
   * @param {Object} data - An object with N properties (categories), which are arrays of objects.
   * @returns {Object} transformedData - An object with N properties (categories), which are arrays of objects with keys in camelCase format.
   */

  console.log("- Running CategoryTransform in categories.mapper.ts");

  // Step 0: Check if the input data is undefined or not an object literal or an empty object:
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Object.keys(data).length
  ) {
    console.log("- No category data provided. Exiting CategoryTransform...");
    return { foods: [], beverages: [] };
  }

  // Step 1: Initialize the placeholder for the transformed data object:
  const transformedData = {};

  // Step 2: Loop over each property in the data object:
  for (const key in data) {
    // Step 3: Map over each array in the data object and returns a new array of objects with the keys in camelCase format:
    transformedData[key] = data[key].map((item) => {
      return camelize(item);
    });
  }
  // Step 4: Return the transformed data:
  return transformedData;
};
