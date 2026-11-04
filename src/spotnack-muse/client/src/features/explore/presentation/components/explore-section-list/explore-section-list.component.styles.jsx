import { FlatList, TouchableOpacity, View } from "react-native";
import styled from "styled-components/native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { Spacing, Size } from "@/shared/theme/theme";

export const ERROR_COLOR = "#ff6b6b";

export const ErrorRow = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: ${Spacing.two}px;
  padding-horizontal: ${Spacing.three}px;
  margin-bottom: ${Spacing.three}px;
`;

export const ErrorText = styled(ThemedText).attrs({ type: "small" })`
  flex: 1;
  color: ${ERROR_COLOR};
`;

export const RetryButton = styled(TouchableOpacity)``;

export const RetryText = styled(ThemedText).attrs({ type: "smallBold" })`
  color: #7b5cf6;
`;

export const ExploreSectionTitle = styled(ThemedText).attrs({
  type: "subtitle",
})`
  padding-left: ${Spacing.three}px;
  margin-bottom: ${Spacing.two}px;
`;

export const PlaceholderSectionTitle = styled(ThemedView).attrs({
  type: "backgroundElement",
})`
  height: 14px;
  width: 100px;
  border-radius: ${Size.three}px;
  margin-left: ${Spacing.three}px;
  margin-bottom: ${Spacing.two}px;
`;

const PlaceholderSectionCardContainer = styled(ThemedView).attrs({
  type: "backgroundElement",
})`
  height: 200px;
  width: 200px;
  margin-left: ${Spacing.two}px;
  margin-bottom: ${Spacing.three}px;
  border-radius: ${Size.three}px;
`;

export const PlaceholderSectionCard = () => {
  const renderItem = () => <PlaceholderSectionCardContainer />;
  return (
    <FlatList
      data={Array(4).fill(null)}
      renderItem={renderItem}
      keyExtractor={(_item, index) => index.toString()}
      horizontal={true}
      showsHorizontalScrollIndicator={false}
    />
  );
};
