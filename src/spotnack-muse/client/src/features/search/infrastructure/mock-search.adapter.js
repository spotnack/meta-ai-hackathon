/*
This file is responsible for designing the search engine to fetching the data from the DynamoDB database.
*/

// This reaches into the explore feature's mock data source, which is a
// known, deliberate exception to feature isolation: this adapter stands in
// for a real search backend (a future implementation would call a real
// search API instead), and the only "index" available to search against
// today is explore's mocked category listings.
import { categoryServerData } from "@features/explore/infrastructure/mock-category-items.data-source";

// External library:
import camelize from "camelize";

// Utils:
import {
  isNonEmptyObject,
  isKeywordValid,
  filterCategoryItemsByKeyword,
  isValidCategoryItem,
} from "../domain/search-keyword.utils";

// Main searchRequest function:
export const searchRequest = async (keyword: string): Promise<Object> => {
  console.log(
    "- Running searchRequest upon keyword search in mock-search.adapter.ts..."
  );

  if (!isKeywordValid(keyword)) {
    return null;
  }

  if (!isNonEmptyObject(categoryServerData)) {
    console.log(
      `***category data is empty or invalid type. Data is of type ${typeof categoryServerData}. Exiting searchRequest...`
    );
    return null;
  }

  const searchResult = {};

  for (let categoryKey in categoryServerData) {
    const normalizedCategoryKey = camelize(categoryKey);
    const categoryArray = categoryServerData[categoryKey];

    const filteredCategoryArray = categoryArray.filter(isValidCategoryItem);

    // An empty (or fully invalid) category is left out; the others still
    // show. It used to end the whole search, so emptying one category
    // (e.g. Beverages) hid every section.
    if (!filteredCategoryArray.length) {
      console.log(
        `*** Category "${categoryKey}" has no valid items. Skipping it...`
      );
      continue;
    }

    let filteredSearchArray =
      keyword === "all"
        ? filteredCategoryArray
        : filterCategoryItemsByKeyword(filteredCategoryArray, keyword);

    if (!filteredSearchArray.length) {
      console.log(
        "- No category was matched or no data was found. Assigning top 20 recommended data..."
      );
      filteredSearchArray = filteredCategoryArray.slice(0, 20);
    }

    searchResult[normalizedCategoryKey] = filteredSearchArray;
  }

  return searchResult;
};