// Styles for ProfileScreen() component.

import { Image, TouchableOpacity } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { MaxContentWidth, Spacing } from "@/shared/theme/theme";

export const Container = styled(ThemedView)`
  max-width: ${MaxContentWidth}px;
  flex-grow: 1;
`;

export const TitleContainer = styled(ThemedView)`
  gap: ${Spacing.three}px;
  align-items: center;
  padding-horizontal: ${Spacing.four}px;
  padding-vertical: ${Spacing.six}px;
`;

export const Avatar = styled(Image)`
  width: 80px;
  height: 80px;
  border-radius: 40px;
  margin-vertical: 8px;
`;

export const Spacer = styled(ThemedView)`
  height: 24px;
`;

export const SignOutButton = styled(TouchableOpacity)`
  border-radius: 25px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.3);
  padding-vertical: 12px;
  padding-horizontal: 32px;
  align-items: center;
`;

export const SignOutText = styled(ThemedText)`
  color: #ff6b6b;
  font-weight: 600;
  font-size: 15px;
`;
