import { StyleSheet } from "react-native";
import styled from "styled-components/native";

import { ThemedView } from "@/shared/theme/themed-view";
import { Spacing } from "@/shared/theme/theme";

export const Stage3dContainer = styled(ThemedView).attrs({
  type: "backgroundElement",
})`
  flex: 1;
`;

export const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding-horizontal: ${Spacing.three}px;
  padding-vertical: ${Spacing.two}px;
`;

export const BackButton = styled.TouchableOpacity`
  padding: ${Spacing.two}px;
`;

export const CanvasContainer = styled.View`
  flex: 1;
`;

export const NameFooter = styled.View`
  align-items: center;
  padding-vertical: ${Spacing.three}px;
`;

const STAGE_BACKGROUND = "#39363b";

export const stageStyles = StyleSheet.create({
  nameText: { color: "#fff" },
  safeArea: { flex: 1 },
  canvas: { flex: 1 },
  background: STAGE_BACKGROUND,
  // Fills the canvas area when the item has no renderable model.
  placeholder: { height: "100%", backgroundColor: STAGE_BACKGROUND },
});

export const BACK_ICON_COLOR = "#fff";
export const BACK_ICON_SIZE = 24;
