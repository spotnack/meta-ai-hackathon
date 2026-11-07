import { KeyboardAvoidingView, Pressable, TextInput, TouchableOpacity, View } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Size, Spacing } from "@/shared/theme/theme";

export const LINK_COLOR = "#7b5cf6";
export const ERROR_COLOR = "#ff6b6b";
const COMPACT_SPACING = Spacing.two + Spacing.one;

export const DialogLayout = styled(KeyboardAvoidingView)`
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

export const DialogPanel = styled(ThemedView).attrs({ type: "backgroundElement" })`
  width: 100%;
  max-width: 400px;
  border-radius: ${Size.three}px;
  padding: ${Spacing.three}px;
  gap: ${COMPACT_SPACING}px;
`;

export const DialogTitle = styled(ThemedText)`
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
`;

// Theme colors come in as props: $textColor, $backgroundColor, $borderColor.
export const NameInput = styled(TextInput)`
  border-radius: ${COMPACT_SPACING}px;
  border-width: 1px;
  padding: ${COMPACT_SPACING}px;
  font-size: 16px;
  color: ${({ $textColor }) => $textColor};
  background-color: ${({ $backgroundColor }) => $backgroundColor};
  border-color: ${({ $borderColor }) => $borderColor};
`;

export const ErrorText = styled(ThemedText).attrs({ type: "small" })`
  color: ${ERROR_COLOR};
`;

export const ActionsRow = styled(View)`
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: ${Spacing.four}px;
  margin-top: ${Spacing.one}px;
`;

export const ActionButton = styled(TouchableOpacity)`
  min-width: ${Size.five}px;
  min-height: ${Size.four}px;
  align-items: center;
  justify-content: center;
  opacity: ${({ $dimmed }) => ($dimmed ? 0.4 : 1)};
`;

export const SaveText = styled(ThemedText).attrs({ type: "smallBold" })`
  color: ${LINK_COLOR};
`;
