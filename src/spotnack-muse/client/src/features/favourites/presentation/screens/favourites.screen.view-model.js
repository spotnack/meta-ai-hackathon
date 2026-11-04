// ViewModel Presentation logic layer: resolves stored favourites into the items the Favourites screen renders.
// The screen itself stays presentation-only, i.e., no useContext, no business/domain logic.

// React Hooks:
import { useContext, useMemo } from "react";
import { useRouter } from "expo-router";

// Contexts:
import { FavouritesContext } from "@features/favourites/application/favourites.context";
import { useGeneratedShapesContext } from "@features/generated-shapes/application/generated-shapes.context";
import {
  generatedShapeToExploreItem,
  isGeneratedShapeItem,
} from "@features/generated-shapes/application/generated-shapes-to-explore-item.mapper";

export const useFavouritesScreenViewModel = () => {
  const router = useRouter();
  const { favourites } = useContext(FavouritesContext);
  const { generatedShapes, isLoading, error } = useGeneratedShapesContext();

  // A favourite is a stored copy of the item. Generated shapes are re-resolved from storage, so their file URIs
  // stay current (iOS moves the app container on updates) and ones deleted since are dropped. Until storage
  // has loaded (or if it failed to), the stored copy is shown instead.
  const items = useMemo(() => {
    const generatedItems = new Map(
      generatedShapes.map((shape) => [shape.id, generatedShapeToExploreItem(shape)]),
    );
    return favourites.flatMap((favourite) => {
      if (!isGeneratedShapeItem(favourite)) return [favourite];
      const generatedItem = generatedItems.get(favourite.id);
      if (generatedItem) return [generatedItem];
      return isLoading || error ? [favourite] : [];
    });
  }, [favourites, generatedShapes, isLoading, error]);

  return {
    items,
    goBack: () => router.back(),
  };
};
