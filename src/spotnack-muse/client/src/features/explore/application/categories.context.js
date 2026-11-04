/*
Application-layer responsible for creating a context for the generated shape categories.
*/

// React Dependencies:
import React, { useState, createContext, useEffect, useContext } from "react";

// Custom Dependencies:
import { CategoryTransform } from "../infrastructure/categories.mapper";

// Context Dependencies:
import { SearchContext } from "@features/search/application/search.context";

// Creating a global context for the categories:
export const CategoriesContext = createContext();

/**
 * Provides category data to the component tree.
 * @param {object} root0 - Provider props.
 * @param {React.ReactNode} root0.children - Child components.
 * @returns {React.JSX.Element} Categories context provider.
 */
export const CategoriesContextProvider = ({ children }) => {
  console.log("- Running CategoriesContextProvider in categories.context.jsx");

  // Search context (reanming iscategoryLoading to isSearchLoading to avoid naming conflicts):
  const { searchResult, isSearchLoading, searchError } =
    useContext(SearchContext);
  // State for the categories:
  const [categories, setCategories] = useState({
    foods: [],
    beverages: [],
  });
  // State for the isCategoryLoading:
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);
  // State for the categoryError:
  const [categoryError, setCategoryError] = useState(null);

  useEffect(() => {
    if (searchResult) {
      console.log("- Running useEffect in categories.context.jsx");
      setIsCategoryLoading(true);
      try {
        let result = CategoryTransform(searchResult);
        setCategories(result); // The result will propagate to the categories state, but not immediately.
      } catch (err) {
        console.error(
          "- ### A categoryError occurred while transforming the category data in categories.context.jsx:",
          err,
        );
        setCategoryError(err);
      } finally {
        setIsCategoryLoading(false); // Ensure loading state is reset in both success and categoryError cases.
      }
    }
  }, [searchResult]); // Runs when the component first mounts and whenever searchResult changes.

  // Combined loading state:
  const combinedIsLoading = isCategoryLoading || isSearchLoading;
  // Combined categoryError state:
  const combinedError = categoryError || searchError;

  return (
    <CategoriesContext.Provider
      value={{
        categories,
        isCategoryLoading: combinedIsLoading,
        categoryError: combinedError,
      }}
    >
      {children}
    </CategoriesContext.Provider>
  );
};
