// Styles for HomeScreen() component.

import { StyleSheet } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/shared/theme/theme";

export const HomeScreenContainer = styled(ThemedView)`
  flex-grow: 1;
  max-width: ${MaxContentWidth}px;
  //background-color: green;
`;

export const TopMenuContainer = styled(ThemedView)`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-left: ${Spacing.three}px;
  padding-right: ${Spacing.two}px;
  //background-color: red;
`;

export const TitleContainer = styled(ThemedView)`
  gap: ${Spacing.three}px;
  align-items: center;
  padding-horizontal: ${Spacing.four}px;
  padding-vertical: ${Spacing.five}px;
`;

export const CenterText = styled(ThemedText).attrs({
  themeColor: "textSecondary",
})`
  text-align: center;
`;

export const ConverterContainer = styled(ThemedView)`
  padding-horizontal: ${Spacing.three}px;
`;

export const homeStyles = StyleSheet.create({
  // Keeps the Convert button clear of the tab bar. No flexGrow: useFitToViewport measures the content's own height.
  scrollContent: { paddingBottom: BottomTabInset + Spacing.three },
});
