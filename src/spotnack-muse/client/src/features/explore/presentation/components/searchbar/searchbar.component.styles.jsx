import { Searchbar as Search } from "react-native-paper";
import styled from "styled-components/native";

import { Spacing } from "@/shared/theme/theme";

// $textColor colors the typed text (react-native-paper styles the input
// through inputStyle, which has no CSS equivalent); $backgroundColor the bar.
export const StyledSearchBar = styled(Search).attrs(({ $textColor }) => ({
  inputStyle: { color: $textColor },
}))`
  border-radius: ${Spacing.six}px;
  background-color: ${({ $backgroundColor }) => $backgroundColor};
`;
