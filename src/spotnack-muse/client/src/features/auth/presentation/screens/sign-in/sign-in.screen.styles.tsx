import { LinearGradient } from "expo-linear-gradient";
import { TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { Spacing } from "@/shared/theme/theme";

export const Container = styled(View)`
  flex: 1;
  background-color: #000000;
`;

export const SafeAreaContainer = styled(SafeAreaView)`
  flex: 1;
`;

export const TopRow = styled(View)`
  flex-direction: row;
  align-items: center;
  padding-left: ${Spacing.three}px;
  padding-right: ${Spacing.two}px;
`;

export const FormSection = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: flex-start;
  padding-top: ${Spacing.six}px;
  padding-horizontal: ${Spacing.four}px;
`;

export const Title = styled(ThemedText)`
  color: #ffffff;
  font-size: 28px;
  line-height: 36px;
  font-weight: 700;
  text-align: center;
  margin-bottom: ${Spacing.three}px;
`;

export const SocialButton = styled(TouchableOpacity)`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  border-radius: 25px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.5);
  background-color: rgba(255, 255, 255, 0.04);
  padding-vertical: 13px;
  padding-horizontal: 20px;
  width: 100%;
  gap: ${Spacing.two}px;
`;

export const SocialButtonText = styled(ThemedText)`
  color: #ffffff;
  font-size: 15px;
  font-weight: 500;
`;

export const SocialGroup = styled(View)`
  width: 100%;
  gap: ${Spacing.two}px;
  margin-bottom: ${Spacing.three}px;
`;

export const DividerRow = styled(View)`
  flex-direction: row;
  align-items: center;
  width: 100%;
  margin-vertical: ${Spacing.two}px;
`;

export const DividerLine = styled(View)`
  flex: 1;
  height: 1px;
  background-color: rgba(255, 255, 255, 0.2);
`;

export const DividerText = styled(ThemedText)`
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  padding-horizontal: ${Spacing.two}px;
`;

export const FieldGroup = styled(View)`
  width: 100%;
  gap: ${Spacing.two}px;
  margin-bottom: ${Spacing.three}px;
`;

// Border of an input with a field error.
const INPUT_ERROR_COLOR = "#ff6b6b";

export const StyledInput = styled(TextInput)<{ $hasError?: boolean }>`
  width: 100%;
  border-radius: 25px;
  border-width: 1px;
  border-color: ${({ $hasError }) =>
    $hasError ? INPUT_ERROR_COLOR : "rgba(255, 255, 255, 0.4)"};
  background-color: transparent;
  padding-vertical: 14px;
  padding-horizontal: 20px;
  font-size: 16px;
  color: #ffffff;
`;

export const SubmitGradientBorder = styled(LinearGradient).attrs({
  colors: ["#9B30FF", "#FF6BD6"] as string[],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
})`
  border-radius: 30px;
  padding: 1.5px;
  width: 100%;
`;

export const SubmitInner = styled(View)`
  border-radius: 29px;
  background-color: #ffffff;
  padding-vertical: 14px;
  align-items: center;
  justify-content: center;
`;

export const SubmitButton = styled(TouchableOpacity)`
  width: 100%;
  margin-bottom: ${Spacing.three}px;
`;

export const SubmitButtonText = styled(ThemedText)`
  color: #000000;
  font-size: 16px;
  font-weight: 700;
`;

export const LinkRow = styled(View)`
  align-items: center;
  gap: ${Spacing.one}px;
`;

export const LinkButton = styled(TouchableOpacity)``;

export const LinkText = styled(ThemedText)`
  color: #7b5cf6;
  font-size: 14px;
  text-align: center;
  text-decoration-line: underline;
`;

export const ErrorText = styled(ThemedText)`
  color: #ff6b6b;
  font-size: 14px;
  text-align: center;
  margin-bottom: ${Spacing.two}px;
`;

export const FieldErrorText = styled(ThemedText)`
  color: #ff6b6b;
  font-size: 12px;
  margin-top: -4px;
  margin-left: 12px;
`;

