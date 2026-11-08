import { View } from "react-native";
import { MenuView } from "@expo/ui/community/menu";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Fonts, Spacing, Size } from "@/shared/theme/theme";

export const MENU_ICON_COLOR = "#ffffff";

// $fullWidth: a full-width card (Favourites list) instead of a 200 px tile.
export const ExploreCard = styled(ThemedView).attrs({
  type: "backgroundElement",
})`
  height: 200px;
  width: ${({ $fullWidth }) => ($fullWidth ? "95%" : "200px")};
  align-self: ${({ $fullWidth }) => ($fullWidth ? "center" : "auto")};
  margin-left: ${({ $fullWidth }) => ($fullWidth ? 0 : Spacing.two)}px;
  margin-bottom: ${({ $fullWidth }) => ($fullWidth ? 0 : Spacing.three)}px;
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

// The options menu sits in the card's upper-right corner.
export const MenuAnchor = styled(MenuView)`
  position: absolute;
  top: ${Spacing.two}px;
  right: ${Spacing.two}px;
  z-index: 10;
`;

// Spinner in the menu's place while an action runs.
export const BusyMenuTrigger = styled(MenuTrigger)`
  position: absolute;
  top: ${Spacing.two}px;
  right: ${Spacing.two}px;
  z-index: 10;
`;
