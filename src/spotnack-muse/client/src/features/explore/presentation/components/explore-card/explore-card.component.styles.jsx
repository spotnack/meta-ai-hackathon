import { StyleSheet, View } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Fonts, Spacing, Size } from "@/shared/theme/theme";

export const MENU_ICON_COLOR = "#ffffff";

export const ExploreCard = styled(ThemedView).attrs({
  type: "backgroundElement",
})`
  height: 200px;
  width: 200px;
  margin-left: ${Spacing.two}px;
  margin-bottom: ${Spacing.three}px;
  border-radius: ${Size.three}px;
  overflow: hidden;
`;

export const CardBottomContainer = styled(ThemedView).attrs({
  type: "backgroundSelected",
})`
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

export const CardInfoContainer = styled(ThemedView)`
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-left: ${Spacing.three}px;
  margin-right: ${Spacing.three}px;
  background-color: transparent;
`;

export const NameText = styled(ThemedText).attrs({ type: "label" })`
  font-family: ${Fonts.serif};
  line-height: ${Size.four}px;
`;

export const InfoColumn = styled(View)`
  flex: 1;
  justify-content: center;
  gap: ${Spacing.one}px;
  margin-right: ${Spacing.two}px;
`;

export const DateText = styled(ThemedText).attrs({
  type: "small",
  themeColor: "textSecondary",
})`
  line-height: ${Size.three}px;
`;

export const MenuTrigger = styled(View)`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.55);
`;

// Positions the options menu's anchor (MenuView renders its own host view, so this is a plain style).
export const cardStyles = StyleSheet.create({
  menuAnchor: {
    position: "absolute",
    top: Spacing.two,
    right: Spacing.two,
    zIndex: 10,
  },
});
