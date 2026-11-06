// React components:
import { useCallback, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";

// Custom styles:
import {
  ExploreSectionTitle,
  PlaceholderSectionTitle,
  PlaceholderSectionCard,
  ErrorRow,
  ErrorText,
  RetryButton,
  RetryText,
  ERROR_COLOR,
} from "./explore-section-list.component.styles";

// Custom components:
import { ExploreCardComponent } from "../explore-card/explore-card.component";
import { InfiniteScrolling } from "@shared/ui/infinite-scrolling/infinite-scrolling.component";
import { BlinkingAnimation } from "@shared/ui/animation/blinking/blinking-animation.component";
import {
  sameIdList,
  takeVisibleIds,
} from "../explore-card/gl-preview-policy";

// Stable defaults: a fresh [] on every render would change extraData and re-render every card (and its 3D canvas).
const NO_MENU_ACTIONS = [];
const NO_BUSY_IDS = [];
const NO_VISIBLE_IDS = [];

// A card counts as visible past half its area; paging shows one card at a
// time, so this is normally a single id. Stable reference: FlatList warns
// on a fresh viewabilityConfig every render.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

// Component:
export const ExploreSectionListComponent = ({
  sectionTitle,
  data,
  pageToNavigate,
  isLoading,
  error,
  onRetry,
  getMenuActions,
  busyIds = NO_BUSY_IDS,
  previewOnly = false,
}) => {
  /*
   * The ExploreSectionListComponent is a FlatList component that renders a list of explore cards.
   * @param {String} sectionTitle - The title of the section.
   * @param {Array} data - An array of explore objects containing relevant data to display.
   * @param {String} pageToNavigate - The page to navigate to.
   * @param {Boolean} isLoading - A boolean to determine if the data is still loading.
   * @param {Error} [error] - A load error, shown with a retry button when there is nothing to display.
   * @param {Function} [onRetry] - Called by the retry button.
   * @param {Function} [getMenuActions] - Returns an item's options-menu actions; items without any get no menu.
   * @param {Array} [busyIds] - Ids of items with an action in progress (their menu shows a spinner).
   * @param {Boolean} [previewOnly] - A conversion is running: every card renders its static thumbnail.
   */

  data = data || [];

  // Ids of the cards currently competing for a live-GL lease (at most 2).
  const [visibleIds, setVisibleIds] = useState(NO_VISIBLE_IDS);
  const handleViewableItemsChanged = useCallback(({ viewableItems }) => {
    setVisibleIds((prev) => {
      const next = takeVisibleIds(viewableItems);
      return sameIdList(prev, next) ? prev : next;
    });
  }, []);

  // Checking if data is undefined or empty:
  const isPlaceholder = !data || data.length === 0;

  // Rendering the explore card component:
  const renderItem = ({ item }) => (
    <ExploreCardComponent
      item={item}
      pageToNavigate={pageToNavigate}
      menuActions={getMenuActions?.(item) ?? NO_MENU_ACTIONS}
      isBusy={busyIds.includes(item.id)}
      glVisible={visibleIds.includes(item.id)}
      previewOnly={previewOnly}
    />
  );

  // Cells only re-render when data/extraData change, and the busy/visible/preview state lives outside
  // `data`. Memoized: a fresh object every render would re-render every card (and its 3D canvas).
  const extraData = useMemo(
    () => ({ busyIds, visibleIds, previewOnly }),
    [busyIds, visibleIds, previewOnly],
  );

  // Common props for the FlatList component:
  const commonProps = {
    renderItem,
    keyExtractor: (item) => item.id,
    extraData,
    showsHorizontalScrollIndicator: false,
    horizontal: true,
    onViewableItemsChanged: handleViewableItemsChanged,
    viewabilityConfig: VIEWABILITY_CONFIG,
  };

  if (isLoading) {
    return (
      <BlinkingAnimation>
        <PlaceholderSectionTitle />
        <PlaceholderSectionCard />
      </BlinkingAnimation>
    );
  }

  if (error && isPlaceholder) {
    return (
      <ErrorRow accessibilityRole="alert">
        <Ionicons name="alert-circle-outline" size={18} color={ERROR_COLOR} />
        <ErrorText>Couldn&apos;t load {sectionTitle?.toLowerCase()}.</ErrorText>
        {onRetry && (
          <RetryButton onPress={onRetry} accessibilityRole="button">
            <RetryText>Try again</RetryText>
          </RetryButton>
        )}
      </ErrorRow>
    );
  }

  if (isPlaceholder) return null;

  return (
    <>
      <ExploreSectionTitle>{sectionTitle}</ExploreSectionTitle>
      <InfiniteScrolling
        data={data}
        batchSize={3}
        {...commonProps}
        scrollEventThrottle={16}
        pagingEnabled={true}
        onEndReachedThreshold={0.5}
      />
    </>
  );
};
