// Styles for ProfileScreen() component.

import styled from "styled-components/native";

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
