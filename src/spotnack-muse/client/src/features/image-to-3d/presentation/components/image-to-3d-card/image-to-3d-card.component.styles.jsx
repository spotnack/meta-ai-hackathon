import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Size, Spacing } from "@/shared/theme/theme";

// Brand accents, shared with the auth screens' call-to-action and links.
const GRADIENT_COLORS = ["#9B30FF", "#FF6BD6"];
export const LINK_COLOR = "#7b5cf6";
export const ERROR_COLOR = "#ff6b6b";
export const SUCCESS_COLOR = "#3ecf8e";
export const ON_MEDIA_COLOR = "#ffffff";
// Same backdrop as the 3D viewer, so the preview reads as "the stage" in both themes.
const PREVIEW_BACKGROUND = "#242225";
const MEDIA_CHIP_BACKGROUND = "rgba(0, 0, 0, 0.55)";

// The preview is the card's only flexible part: the Home screen sizes it between these bounds to fit the viewport.
export const PREVIEW_MIN_HEIGHT = 150;
export const PREVIEW_MAX_HEIGHT = 240;

const COMPACT_SPACING = Spacing.two + Spacing.one;
const INNER_RADIUS = Size.two + Size.one;

export const Card = styled(ThemedView).attrs({ type: "backgroundElement" })`
  border-radius: ${Size.three}px;
  padding: ${COMPACT_SPACING}px;
  gap: ${COMPACT_SPACING}px;
`;

export const EmptyPicker = styled(TouchableOpacity)`
  border-radius: ${INNER_RADIUS}px;
  border-width: 1.5px;
  border-style: dashed;
  align-items: center;
  justify-content: center;
  gap: ${Spacing.one}px;
  padding-horizontal: ${Spacing.four}px;
`;

export const EmptyPickerIconCircle = styled(ThemedView).attrs({
  type: "backgroundSelected",
})`
  width: 56px;
  height: 56px;
  border-radius: 28px;
  align-items: center;
  justify-content: center;
  margin-bottom: ${Spacing.one}px;
`;

export const CenteredText = styled(ThemedText)`
  text-align: center;
`;

export const PreviewFrame = styled(View)`
  border-radius: ${INNER_RADIUS}px;
  overflow: hidden;
  background-color: ${PREVIEW_BACKGROUND};
`;

export const PreviewImage = styled(Image).attrs({
  contentFit: "contain",
  transition: 200,
})`
  flex: 1;
`;

export const ClearButton = styled(TouchableOpacity)`
  position: absolute;
  top: ${Spacing.two}px;
  right: ${Spacing.two}px;
  width: ${Size.five}px;
  height: ${Size.five}px;
  border-radius: ${Size.three}px;
  align-items: center;
  justify-content: center;
  background-color: ${MEDIA_CHIP_BACKGROUND};
`;

export const ChangePhotoButton = styled(TouchableOpacity)`
  position: absolute;
  left: ${Spacing.two}px;
  bottom: ${Spacing.two}px;
  flex-direction: row;
  align-items: center;
  gap: ${Spacing.one}px;
  padding: ${Spacing.one}px 10px;
  border-radius: 14px;
  background-color: ${MEDIA_CHIP_BACKGROUND};
`;

export const ImageSizeBadge = styled(View)`
  position: absolute;
  right: ${Spacing.two}px;
  bottom: ${Spacing.two}px;
  padding: ${Spacing.half}px ${Spacing.two}px;
  border-radius: ${Size.two}px;
  background-color: ${MEDIA_CHIP_BACKGROUND};
`;

export const OnMediaText = styled(ThemedText).attrs({ type: "smallBold" })`
  color: ${ON_MEDIA_COLOR};
`;

export const ImageSizeText = styled(ThemedText).attrs({ type: "code" })`
  color: ${ON_MEDIA_COLOR};
`;

export const ConvertingOverlay = styled(View)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  align-items: center;
  justify-content: center;
  gap: ${Spacing.two}px;
  padding-horizontal: ${Spacing.four}px;
  background-color: rgba(0, 0, 0, 0.6);
`;

export const ProgressTrack = styled(View)`
  width: 100%;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.2);
`;

export const ProgressFill = styled(LinearGradient).attrs({
  colors: GRADIENT_COLORS,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
})`
  height: 100%;
  border-radius: 3px;
`;

export const InlineButton = styled(TouchableOpacity)`
  flex-direction: row;
  align-items: center;
  gap: ${Spacing.one}px;
`;

export const StatusRow = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: ${Spacing.two}px;
  padding: ${Spacing.two}px ${COMPACT_SPACING}px;
  border-radius: ${INNER_RADIUS}px;
`;

export const StatusText = styled(ThemedText).attrs({ type: "small" })`
  flex: 1;
`;

export const LinkText = styled(ThemedText).attrs({ type: "smallBold" })`
  color: ${LINK_COLOR};
`;

// Gradient-bordered pill: same treatment as the sign-in screen's primary action.
export const ConvertButton = styled(TouchableOpacity)`
  width: 100%;
`;

export const ConvertGradientBorder = styled(LinearGradient).attrs({
  colors: GRADIENT_COLORS,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
})`
  border-radius: 30px;
  padding: 1.5px;
`;

export const ConvertInner = styled(View)`
  flex-direction: row;
  border-radius: 29px;
  background-color: #ffffff;
  padding-vertical: ${COMPACT_SPACING}px;
  align-items: center;
  justify-content: center;
  gap: ${Spacing.two}px;
`;

export const ConvertButtonText = styled(ThemedText)`
  color: #000000;
  font-size: 16px;
  font-weight: 700;
`;

export const cardStyles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  errorRow: { backgroundColor: "rgba(255, 107, 107, 0.12)" },
  successRow: { backgroundColor: "rgba(62, 207, 142, 0.12)" },
});
