// Styles for ExploreScreen() component.

import styled from "styled-components/native";

import { ThemedView } from "@/shared/theme/themed-view";
import { MaxContentWidth, Spacing } from "@/shared/theme/theme";

export const ExploreScreenContainer = styled(ThemedView)`
  flex: 1;
  max-width: ${MaxContentWidth}px;
  padding-left: ${Spacing.two}px;
  padding-right: ${Spacing.two}px;
  //background-color: green;
`;

export const TopMenuContainer = styled(ThemedView)`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-left: ${Spacing.two}px;
  padding-right: ${Spacing.two}px;
  //background-color: red;
`;

export const TopMenuRightContainer = styled(ThemedView)`
  flex-direction: row;
  align-items: center;
  //background-color: yellow;
`;

export const SearchContainer = styled(ThemedView)`
  align-items: center;
  padding-bottom: ${Spacing.three}px;
  //background-color: yellow;
`;

export const GeneratedShapesContainer = styled(ThemedView)`
  flex: 1;
  margin-bottom: ${Spacing.six}px;
  //background-color: blue;
`;

export const TitleContainer = styled(ThemedView)`
  gap: ${Spacing.three}px;
  align-items: center;
  padding-horizontal: ${Spacing.four}px;
  padding-vertical: ${Spacing.five}px;
  //background-color: purple;
`;
