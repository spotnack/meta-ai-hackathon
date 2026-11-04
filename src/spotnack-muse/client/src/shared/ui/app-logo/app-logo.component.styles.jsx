import styled from "styled-components/native";

import { ThemedView } from "@/shared/theme/themed-view";
import { Spacing } from "@/shared/theme/theme";

export const Logo = styled.Image.attrs({
  resizeMode: "contain", // Ensure logo does not overflow its parent container when height changes.
})`
  width: ${Spacing.seven}px;
  height: ${Spacing.seven}px;
`;
