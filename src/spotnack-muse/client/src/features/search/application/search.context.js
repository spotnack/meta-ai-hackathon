/*
Application-layer responsible for creating a context for the search engine.
*/

// React Dependencies:
import React, { useState, useEffect } from "react";

// Custom Dependencies:
import { searchRequest } from "../infrastructure/mock-search.adapter";
import { ALL_ITEMS_KEYWORD } from "../domain/search-keyword.utils";

// Creating a global context for the search engine:
export const SearchContext = React.createContext();

/**
 * Provides search state and actions to the component tree.
 * @param {object} root0 - Provider props.
 * @param {React.ReactNode} root0.children - Child components.
 * @returns {React.JSX.Element} Search context provider.
 */
export const SearchContextProvider = ({ children }) => {
  console.log("- Running SearchContextProvider in search.context.jsx");

  const [searchResult, setSearchResult] = useState(null);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const defaultKeyword = ALL_ITEMS_KEYWORD;
  // The keyword behind the current searchResult, so lists searched outside the adapter
  // (e.g. the user's own creations) filter by the same keyword at the same moment.
  const [appliedKeyword, setAppliedKeyword] = useState(defaultKeyword);

  const onSearch = (searchKeyword) => {
    /*
     * This function is called when the user types in the search bar from searchbar.component.jsx.
     * @param {string} searchKeyword - The keyword to search for.
     */
    console.log("- Running onSearch in search.context.jsx");
    setIsSearchLoading(true);

    if (!searchKeyword) {
      console.log("- No search keyword provided. Exiting onSearch...");
      setIsSearchLoading(false);
      return;
    }

    const fetchData = async () => {
      console.log("- Running fetchData (async) in search.context.jsx");
      setTimeout(async () => {
        try {
          const result = await searchRequest(searchKeyword);
          setSearchResult(result);
          // A null result leaves the categories unchanged, so the applied keyword stays too.
          if (result) setAppliedKeyword(searchKeyword);
        } catch (err) {
          console.error(
            `- ### A searchError occurred while fetching search results in search.context.jsx: ${err}`,
          );
          setSearchError(err);
        } finally {
          setIsSearchLoading(false); // Ensure loading state is reset in both success and searchError cases.
        }
      }, 2000);
    };

    void fetchData();
  };

  useEffect(() => {
    console.log("- Running useEffect in search.context.jsx");
    onSearch(defaultKeyword);
  }, []); // Runs only once, when the component first mounts.

  return (
    <SearchContext.Provider
      value={{
        searchResult,
        searchKeyword: appliedKeyword,
        isSearchLoading,
        search: onSearch,
        searchError,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};
