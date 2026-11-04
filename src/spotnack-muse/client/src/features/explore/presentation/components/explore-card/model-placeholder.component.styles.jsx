import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { Size, Spacing } from "@/shared/theme/theme";

// Matches GlbModelViewer's default canvas, so placeholder and viewer cards share one layout.
export const PLACEHOLDER_HEIGHT = 140;
export const PLACEHOLDER_ICON_COLOR = "#ffffff";

export const PlaceholderContainer = styled(View)`
  width: 100%;
  height: ${PLACEHOLDER_HEIGHT}px;
  align-items: center;
  justify-content: center;
  background-color: #242225;
`;

export const PlaceholderPhoto = styled(Image).attrs({
  contentFit: "cover",
  blurRadius: 3,
  transition: 200,
})`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

export const PlaceholderBadge = styled(View)`
  position: absolute;
  left: ${Spacing.two}px;
  bottom: ${Spacing.two}px;
  padding: ${Spacing.half}px ${Spacing.two}px;
  border-radius: ${Size.two}px;
  background-color: rgba(0, 0, 0, 0.55);
`;

export const PlaceholderBadgeText = styled(ThemedText).attrs({ type: "code" })`
  color: #ffffff;
`;

export const PlaceholderCaption = styled(ThemedText).attrs({ type: "small" })`
  color: #ffffff;
  text-align: center;
  margin-top: ${Spacing.two}px;
  padding-horizontal: ${Spacing.four}px;
`;

export const placeholderStyles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.45)" },
});
