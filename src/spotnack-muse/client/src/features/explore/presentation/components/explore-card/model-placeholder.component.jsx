// React Components:
import { MaterialCommunityIcons } from "@expo/vector-icons";

// Custom Styles:
import {
  PlaceholderContainer,
  PlaceholderPhoto,
  PlaceholderStill,
  PlaceholderBadge,
  PlaceholderBadgeText,
  PlaceholderCaption,
  PlaceholderScrim,
  PLACEHOLDER_ICON_COLOR,
} from "./model-placeholder.component.styles";

/*
Stand-in for a 3D model that can't be rendered (e.g. a creation whose model hasn't been generated yet):
the item's photo behind a cube icon. Card-sized by default; `fill` makes it fill its parent (e.g. the 3D stage) and `background` sets its color.
The PLACEHOLDER badge shows only when the item genuinely has no model: a
real creation that is static (lease cap, conversion running) gets a
neutral "tap to view" hint instead, never the badge.
With `previewUri` (a still of the model, see CategoryItem.previewImage) it
shows that still alone, so a static card looks like the model.
*/
export const ModelPlaceholderComponent = ({
  photoUri,
  previewUri,
  fill = false,
  background,
  iconSize = 40,
  caption,
  badgeText = "PLACEHOLDER",
}) =>
  previewUri ? (
    <PlaceholderContainer $fill={fill} $background={background} accessibilityLabel="3D model preview">
      <PlaceholderStill source={{ uri: previewUri }} />
    </PlaceholderContainer>
  ) : (
    <PlaceholderContainer $fill={fill} $background={background} accessibilityLabel="3D model placeholder">
      {photoUri ? <PlaceholderPhoto source={{ uri: photoUri }} /> : null}
      <PlaceholderScrim />
      <MaterialCommunityIcons
        name="cube-outline"
        size={iconSize}
        color={PLACEHOLDER_ICON_COLOR}
      />
      {caption ? <PlaceholderCaption>{caption}</PlaceholderCaption> : null}
      {badgeText ? (
        <PlaceholderBadge>
          <PlaceholderBadgeText>{badgeText}</PlaceholderBadgeText>
        </PlaceholderBadge>
      ) : null}
    </PlaceholderContainer>

  );
