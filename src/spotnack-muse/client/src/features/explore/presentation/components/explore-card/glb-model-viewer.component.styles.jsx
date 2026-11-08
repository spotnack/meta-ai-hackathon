import { Image, Text, View } from "react-native";
import styled from "styled-components/native";

export const FALLBACK_ICON_COLOR = "rgba(255, 255, 255, 0.6)";

// $fill: fill the parent (Stage screen); otherwise a 140 px card preview,
// the same size as ModelPlaceholderComponent.
export const ViewerContainer = styled(View)`
  ${({ $fill }) => ($fill ? "flex: 1;" : "width: 100%; height: 140px;")}
`;

export const FallbackContainer = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ $backgroundColor }) => $backgroundColor};
`;

export const FallbackPhoto = styled(Image)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0.55;
`;

export const FallbackCaption = styled(Text)`
  margin-top: 8px;
  margin-horizontal: 12px;
  text-align: center;
  font-size: 12px;
  color: ${FALLBACK_ICON_COLOR};
`;
