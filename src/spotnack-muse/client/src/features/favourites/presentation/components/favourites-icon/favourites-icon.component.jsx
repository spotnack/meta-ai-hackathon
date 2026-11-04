import styled from "styled-components/native";
import { Fontisto } from "@expo/vector-icons";
import { Spacing } from "@/shared/theme/theme";

export const FavouritesBarIcon = styled(Fontisto).attrs({
  name: "bookmark-alt",
  size: Spacing.five,
  color: "cyan",
})``;

export const FavouritesCardIcon = styled(Fontisto).attrs({
  size: Spacing.four,
  color: "cyan",
})``;
