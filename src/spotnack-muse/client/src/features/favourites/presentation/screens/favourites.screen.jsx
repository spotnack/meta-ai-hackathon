// View layer: imports JSX/TSX components.

// React:
import { TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Safe area:
import { SafeScreenContainer } from "@/shared/ui/safe-area/screen-container";

// Theme:
import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { useTheme } from "@/hooks/use-theme";

// NOTE: reuses the explore feature's card renderer for a favourited item.
import { ExploreCardComponent } from "@features/explore/presentation/components/explore-card/explore-card.component";

// ViewModel:
import { useFavouritesScreenViewModel } from "./favourites.screen.view-model";

// Styles:
import {
  FavouritesScreenContainer,
  FavouriteCardWrapper,
  HeaderContainer,
  EmptyStateContainer,
  favouriteCardStyles,
} from "./favourites.screen.styles";

// React Component:
export const FavouritesScreen = () => {
  const theme = useTheme();
  const { items, goBack } = useFavouritesScreenViewModel();

  return (
    <SafeScreenContainer>
      <FavouritesScreenContainer>
        <HeaderContainer>
          <TouchableOpacity onPress={goBack}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <ThemedText type="subtitle">Favourites</ThemedText>
          <ThemedView style={{ width: 24 }} />
        </HeaderContainer>
        {items.length === 0 ? (
          <EmptyStateContainer>
            <ThemedText themeColor="textSecondary">
              No favourites yet. Double-tap a card to add one.
            </ThemedText>
          </EmptyStateContainer>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {items.map((item) => {
              const key = item.id.toString();
              return (
                <FavouriteCardWrapper key={key}>
                  {/* No menu actions here: creations are renamed and deleted from Explore. */}
                  <ExploreCardComponent
                    item={item}
                    pageToNavigate={"Stage3dScreen"}
                    style={favouriteCardStyles.fullWidth}
                  />
                </FavouriteCardWrapper>
              );
            })}
          </ScrollView>
        )}
      </FavouritesScreenContainer>
    </SafeScreenContainer>
  );
};
