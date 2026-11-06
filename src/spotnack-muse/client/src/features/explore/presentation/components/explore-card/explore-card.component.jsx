// React components:
import { useContext, useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useGLTF } from "@react-three/drei/native";
import { Ionicons } from "@expo/vector-icons";
import { MenuView } from "@expo/ui/community/menu";

// Theme:
import { useColorScheme } from "@/hooks/use-color-scheme";

// Custom Styles:
import {
  ExploreCard,
  CardBottomContainer,
  CardInfoContainer,
  NameText,
  InfoColumn,
  DateText,
  MenuTrigger,
  cardStyles,
  MENU_ICON_COLOR,
} from "./explore-card.component.styles";

// Custom Components:
import { GlbModelViewer } from "./glb-model-viewer.component";
import { ModelPlaceholderComponent } from "./model-placeholder.component";
import { useGlViewLease } from "./gl-view-lease";
import {
  LIVE_PREVIEW,
  resolveCardPreview,
} from "./gl-preview-policy";

// Feature Components:
import { FavouritesCardButton } from "@features/favourites/presentation/components/favourites-card-button/favourites-card-button.component";

// Context:
import { FavouritesContext } from "@features/favourites/application/favourites.context";

// Constants:
const MAX_NAME_LENGTH = 25;

const formatCreatedAt = (createdAt) => {
  const date = new Date(createdAt);
  if (!createdAt || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// `icon` is an SF Symbol: shown by the iOS menu, ignored by the Android menu (text only).
const toNativeMenuActions = (menuActions) =>
  menuActions.map(({ id, title, icon, destructive }) => ({
    id,
    title,
    image: icon,
    attributes: destructive ? { destructive: true } : undefined,
  }));

/*
The one card for every explorable item, from the library and the user's own creations alike.
- Preview: a renderable model (item.thumbnail) spins in the 3D viewer while the card holds a live-GL
  lease (at most 2 cards app-wide); otherwise a static placeholder shows item.photos[0]. While a
  conversion runs (`previewOnly`) every card stays static so the NPU keeps its memory.
- A single tap opens pageToNavigate; a double tap (or the bookmark) toggles the favourite.
- An optional item.createdAt is shown under the name.
- `menuActions` ([{ id, title, icon, destructive, onPress }]) adds an options menu in the upper-right corner.
  The caller decides which items get actions (e.g. only items the signed-in user owns); without any, there is no menu.
  While `isBusy` (e.g. deleting), a spinner replaces the menu.
*/
export const ExploreCardComponent = ({
  item,
  pageToNavigate,
  style,
  menuActions = [],
  isBusy = false,
  glVisible = true,
  previewOnly = false,
}) => {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { favourites, addToFavourites, removeFromFavourites } =
    useContext(FavouritesContext);

  const isFavourite = item ? favourites.find((r) => r.id === item.id) : null;
  const modelUri = item?.thumbnail?.[0];
  // A live canvas mounts only for a visible card that holds a lease; every
  // other state (converting, off-screen, out of leases) renders the static
  // photo placeholder instead of attempting GL.
  const leaseGranted = useGlViewLease(
    item?.id,
    glVisible && !previewOnly && Boolean(modelUri),
  );
  const preview = resolveCardPreview({ modelUri, previewOnly, leaseGranted });

  // Preload only while the card wants a live view: a preloaded multi-MB
  // GLB sits in JS memory, which is exactly what a conversion is short of.
  useEffect(() => {
    if (modelUri && glVisible && !previewOnly) useGLTF.preload(modelUri);
  }, [modelUri, glVisible, previewOnly]);

  const navigateToItem = () => {
    if (!item) return;
    router.push({
      pathname: pageToNavigate,
      params: { item: JSON.stringify(item) },
    });
  };

  const toggleFavourite = () => {
    if (!item) return;
    !isFavourite ? addToFavourites(item) : removeFromFavourites(item);
  };

  const singleTapCover = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (success) scheduleOnRN(navigateToItem);
    });

  const doubleTapCover = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (success) scheduleOnRN(toggleFavourite);
    });

  const exclusiveGesture = Gesture.Exclusive(doubleTapCover, singleTapCover);

  if (!item) return null;

  const { name, photos, createdAt } = item;

  const truncatedName =
    name?.length > MAX_NAME_LENGTH
      ? `${name.substring(0, MAX_NAME_LENGTH)}...`
      : name;
  const createdAtLabel = formatCreatedAt(createdAt);

  const handleMenuAction = ({ nativeEvent }) => {
    menuActions.find((action) => action.id === nativeEvent.event)?.onPress();
  };

  return (
    <>
      <ExploreCard style={style}>
        <GestureDetector gesture={exclusiveGesture}>
          <View
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}`}
          >
            {preview === LIVE_PREVIEW ? (
              <GlbModelViewer uri={modelUri} photoUri={photos?.[0]} />
            ) : (
              <ModelPlaceholderComponent photoUri={photos?.[0]} />
            )}
          </View>
        </GestureDetector>
        {menuActions.length > 0 &&
          (isBusy ? (
            <MenuTrigger
              style={cardStyles.menuAnchor}
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size="small" color={MENU_ICON_COLOR} />
            </MenuTrigger>
          ) : (
            // Native menu (SwiftUI on iOS, Material on Android). The trigger must be a plain
            // View: MenuView provides the press handling itself.
            <MenuView
              style={cardStyles.menuAnchor}
              actions={toNativeMenuActions(menuActions)}
              onPressAction={handleMenuAction}
              colorScheme={colorScheme}
            >
              <MenuTrigger
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Options for ${name}`}
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={16}
                  color={MENU_ICON_COLOR}
                />
              </MenuTrigger>
            </MenuView>
          ))}
        <CardBottomContainer>
          <CardInfoContainer>
            <InfoColumn>
              <NameText numberOfLines={1} ellipsizeMode="tail">
                {truncatedName}
              </NameText>
              {createdAtLabel ? <DateText>{createdAtLabel}</DateText> : null}
            </InfoColumn>
            <FavouritesCardButton
              isFavourite={Boolean(isFavourite)}
              onToggle={toggleFavourite}
            />
          </CardInfoContainer>
        </CardBottomContainer>
      </ExploreCard>
    </>
  );
};
