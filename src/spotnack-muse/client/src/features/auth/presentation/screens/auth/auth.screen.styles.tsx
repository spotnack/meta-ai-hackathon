import { LinearGradient } from "expo-linear-gradient";
import { TouchableOpacity, View } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { Spacing } from "@/shared/theme/theme";

export const Container = styled(View)`
  flex: 1;
  background-color: #000000;
`;

export const HeroSection = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-horizontal: ${Spacing.four}px;
  gap: ${Spacing.four}px;
`;

export const HeroText = styled(ThemedText)`
  font-size: 42px;
  font-weight: 800;
  line-height: 52px;
  text-align: center;
  color: #ffffff;
  margin-bottom: ${Spacing.six}px;
`;

export const ButtonGroup = styled(View)`
  width: 100%;
  gap: ${Spacing.two}px;
  margin-top: ${Spacing.four}px;
`;

export const SignInButton = styled(TouchableOpacity)`
  border-radius: 30px;
  border-width: 1.5px;
  border-color: #ffffff;
  padding-vertical: 16px;
  align-items: center;
  justify-content: center;
  background-color: transparent;
`;

export const SignInButtonText = styled(ThemedText)`
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
`;

export const SignUpGradient = styled(LinearGradient).attrs({
  colors: ["#00D4FF", "#9B30FF"] as string[],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
})`
  border-radius: 30px;
  padding-vertical: 16px;
  align-items: center;
  justify-content: center;
`;

export const SignUpButton = styled(TouchableOpacity)`
  border-radius: 30px;
  overflow: hidden;
`;

export const SignUpButtonText = styled(ThemedText)`
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
`;
