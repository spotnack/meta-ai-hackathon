import { Animated, Pressable, View } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Size, Spacing } from "@/shared/theme/theme";

export const SUCCESS_COLOR = "#3ecf8e";

export const ModalLayout = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-horizontal: ${Spacing.three}px;
`;

export const Backdrop = styled(Pressable)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.5);
`;

// Animated values cannot go through CSS: .attrs feeds them to the style
// prop ($opacity: Animated value, $offset: Animated.ValueXY).
export const SwipeLayer = styled(Animated.View).attrs(({ $opacity, $offset }) => ({
  style: {
    opacity: $opacity,
    transform: $offset ? $offset.getTranslateTransform() : [],
  },
}))`
  width: 100%;
  max-width: 400px;
`;

export const NoticePanel = styled(ThemedView).attrs({ type: "backgroundElement" })`
  border-radius: ${Size.three}px;
  padding: ${Spacing.three}px;
  gap: ${Spacing.two}px;
  align-items: center;
`;

export const NoticeTitle = styled(ThemedText)`
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
`;

export const NoticeText = styled(ThemedText).attrs({ type: "small" })`
  text-align: center;
`;

export const HintText = styled(ThemedText).attrs({
  type: "small",
  themeColor: "textSecondary",
})`
  text-align: center;
`;
