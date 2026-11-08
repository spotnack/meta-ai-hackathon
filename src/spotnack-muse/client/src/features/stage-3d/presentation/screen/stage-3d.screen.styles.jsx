import { SafeAreaView } from "react-native-safe-area-context";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
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

export const STAGE_BACKGROUND = "#39363b";

export const SafeArea = styled(SafeAreaView)`
  flex: 1;
`;

export const NameText = styled(ThemedText).attrs({ type: "subtitle" })`
  color: #fff;
`;

export const BACK_ICON_COLOR = "#fff";
export const BACK_ICON_SIZE = 24;
