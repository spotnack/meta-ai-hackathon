// View layer: imports JSX/TSX components.

// React
import { ScrollView } from "react-native-gesture-handler";

// SafeAreaView
import { SafeScreenContainer } from "@/shared/ui/safe-area/screen-container";

// Theme
import { ThemedText } from "@/shared/theme/themed-text";

// Providers
import { CategoriesContextProvider } from "@features/explore/application/categories.context";
import { SearchContextProvider } from "@features/search/application/search.context";

// Custom Components
import { AppLogo } from "@shared/ui/app-logo/app-logo.component";
import { FavouritesToggleButton } from "@features/favourites/presentation/components/favourites-toggle-button/favourites-toggle-button.component";
import { RenameGeneratedShapeDialogComponent } from "@features/generated-shapes/presentation/components/rename-generated-shape-dialog/rename-generated-shape-dialog.component";
import { ExploreSectionListComponent } from "../../components/explore-section-list/explore-section-list.component";
import { SearchBarComponent } from "../../components/searchbar/searchbar.component";

// ViewModel
import { useExploreScreenViewModel } from "./explore.screen.view-model";

import {
  ExploreScreenContainer,
  TopMenuContainer,
  TopMenuRightContainer,
  SearchContainer,
  GeneratedShapesContainer,
  TitleContainer,
} from "./explore.screen.styles";

/**
 * @returns {React.JSX.Element} Explore screen content.
 */
function ExploreScreenContent(): React.JSX.Element {
  const {
    sections,
    isLoading,
    generatedAssets,
    isGeneratedAssetsLoading,
    generatedAssetsError,
    deletingIds,
    getItemMenuActions,
    renamingAsset,
    isRenameSaving,
    renameError,
    cancelRenameGeneratedAsset,
    submitRenameGeneratedAsset,
    retryGeneratedAssets,
  } = useExploreScreenViewModel();

  return (
    <SafeScreenContainer>
      <ExploreScreenContainer>
        <TopMenuContainer>
          <AppLogo />
          <TopMenuRightContainer>
            <FavouritesToggleButton pageToNavigate={"FavouritesScreen"} />
          </TopMenuRightContainer>
        </TopMenuContainer>
        <TitleContainer>
          <ThemedText type="title">3D Assets Library</ThemedText>
        </TitleContainer>
        <SearchContainer>
          <SearchBarComponent />
        </SearchContainer>
        <ScrollView style={{ flex: 1 }}>
          <GeneratedShapesContainer>
            {/* Every section gets the same menu rule: only the signed-in user's own items have actions. */}
            <ExploreSectionListComponent
              sectionTitle="Your Creations"
              data={generatedAssets}
              pageToNavigate="Stage3dScreen"
              isLoading={isGeneratedAssetsLoading}
              error={generatedAssetsError}
              onRetry={() => retryGeneratedAssets()}
              getMenuActions={getItemMenuActions}
              busyIds={deletingIds}
            />
            {Object.keys(sections).map((key) => (
              <ExploreSectionListComponent
                key={key}
                sectionTitle={key.charAt(0).toUpperCase() + key.slice(1)}
                data={sections[key]}
                pageToNavigate="Stage3dScreen"
                isLoading={isLoading}
                getMenuActions={getItemMenuActions}
              />
            ))}
          </GeneratedShapesContainer>
        </ScrollView>
        {renamingAsset && (
          <RenameGeneratedShapeDialogComponent
            currentName={renamingAsset.name}
            isSaving={isRenameSaving}
            error={renameError}
            onCancel={cancelRenameGeneratedAsset}
            onSubmit={submitRenameGeneratedAsset}
          />
        )}
      </ExploreScreenContainer>
    </SafeScreenContainer>
  );
}

/**
 * Explore screen: mounts context providers then renders the screen.
 * @returns {React.JSX.Element} Explore screen.
 */
export default function ExploreScreen(): React.JSX.Element {
  return (
    <SearchContextProvider>
      <CategoriesContextProvider>
        <ExploreScreenContent />
      </CategoriesContextProvider>
    </SearchContextProvider>
  );
}
