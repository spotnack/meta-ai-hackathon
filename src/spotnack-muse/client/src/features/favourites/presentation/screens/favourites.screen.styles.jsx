// Styles for FavouritesScreen() component.

import styled from "styled-components/native";
import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Spacing } from "@/shared/theme/theme";

export const FavouritesScreenContainer = styled.View`
  flex: 1;
  align-items: stretch;
`;

export const FavouriteCardWrapper = styled.View`
  padding-horizontal: ${Spacing.three}px;
  padding-bottom: ${Spacing.three}px;
`;

export const HeaderContainer = styled(ThemedView)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-horizontal: ${Spacing.three}px;
  padding-vertical: ${Spacing.two}px;
`;

export const EmptyStateContainer = styled(ThemedView)`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-horizontal: ${Spacing.four}px;
`;

export const EmptyStateText = styled(ThemedText)`
  text-align: center;
`;

// Same width as the back arrow, so the title stays centered.
export const HeaderSpacer = styled(ThemedView)`
  width: 24px;
`;
