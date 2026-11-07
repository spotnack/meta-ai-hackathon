import { useState, useContext } from "react";

import { useTheme } from "@/hooks/use-theme";
import { SearchContext } from "@features/search/application/search.context";

import { StyledSearchBar } from "./searchbar.component.styles";

export const SearchBarComponent = () => {
  const theme = useTheme();
  const { search } = useContext(SearchContext);
  const [searchKeyword, setSearchKeyword] = useState("");

  return (
    <StyledSearchBar
      placeholder="Search for a 3D asset..."
      placeholderTextColor={theme.textSecondary}
      iconColor={theme.text}
      rippleColor="transparent"
      traileringIconColor={theme.text}
      traileringRippleColor="transparent"
      selectionColor={theme.text}
      $textColor={theme.text}
      $backgroundColor={theme.backgroundElement}
      onSubmitEditing={() => search(searchKeyword)}
      onChangeText={setSearchKeyword}
      value={searchKeyword}
    />
  );
};
