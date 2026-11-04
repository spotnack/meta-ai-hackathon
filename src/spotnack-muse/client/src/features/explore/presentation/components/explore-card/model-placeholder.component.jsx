// React Components:
import { View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

// Custom Styles:
import {
  PlaceholderContainer,
  PlaceholderPhoto,
  PlaceholderBadge,
  PlaceholderBadgeText,
  PlaceholderCaption,
  placeholderStyles,
  PLACEHOLDER_ICON_COLOR,
} from "./model-placeholder.component.styles";

/*
Stand-in for a 3D model that can't be rendered (e.g. a creation whose model hasn't been generated yet):
the item's photo behind a cube icon. Card-sized by default; pass `style` to resize it (e.g. to fill the 3D stage).
*/
export const ModelPlaceholderComponent = ({
  photoUri,
  style,
  iconSize = 40,
  caption,
}) => (
  <PlaceholderContainer style={style} accessibilityLabel="3D model placeholder">
    {photoUri ? <PlaceholderPhoto source={{ uri: photoUri }} /> : null}
    <View style={placeholderStyles.scrim} />
    <MaterialCommunityIcons
      name="cube-outline"
      size={iconSize}
      color={PLACEHOLDER_ICON_COLOR}
    />
    {caption ? <PlaceholderCaption>{caption}</PlaceholderCaption> : null}
    <PlaceholderBadge>
      <PlaceholderBadgeText>PLACEHOLDER</PlaceholderBadgeText>
    </PlaceholderBadge>
  </PlaceholderContainer>
);
