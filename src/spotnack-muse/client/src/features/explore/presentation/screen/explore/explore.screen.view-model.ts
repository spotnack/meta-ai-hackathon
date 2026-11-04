// ViewModel Presentation logic layer: resolves context state into the plain data the Explore screen renders,
// and exposes the page-routing rule.
// The screen itself stays presentation-only, i.e., no useContext, no business/domain logic.

// React Hooks:
import { useCallback, useContext, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "expo-router";

// Contexts:
import { useAuth } from "@features/auth/application/auth.context";
import { CategoriesContext } from "@features/explore/application/categories.context";
import { FavouritesContext } from "@features/favourites/application/favourites.context";
import { SearchContext } from "@features/search/application/search.context";
import { filterItemsBySearchKeyword } from "@features/search/domain/search-keyword.utils";
import { useGeneratedShapesContext } from "@features/generated-shapes/application/generated-shapes.context";
import {
  generatedShapeToExploreItem,
  isItemOwnedByUser,
} from "@features/generated-shapes/application/generated-shapes-to-explore-item.mapper";
import { isGeneratedShapeNameValid } from "@features/generated-shapes/domain/generated-shapes.entity";

// Any explore item: a library item, or one of the signed-in user's creations (which has an ownerId).
type ExploreItem = { id: string; name: string; ownerId?: string | null };

type MenuAction = {
  id: string;
  title: string;
  icon?: string;
  destructive?: boolean;
  onPress: () => void;
};

const NO_MENU_ACTIONS: MenuAction[] = [];

export const useExploreScreenViewModel = () => {
  const { user } = useAuth();
  const { categories, isCategoryLoading } =
    useContext(CategoriesContext);
  const {
    generatedShapes,
    isLoading: isGeneratedShapesLoading,
    error: generatedShapesError,
    update,
    remove,
    refresh,
  } = useGeneratedShapesContext();
  const { favourites, removeFromFavourites } = useContext(FavouritesContext);
  const { searchKeyword } = useContext(SearchContext);

  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [renamingAsset, setRenamingAsset] = useState<ExploreItem | null>(null);
  const [isRenameSaving, setIsRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Re-scan storage whenever Explore gains focus, so assets saved while it was in the background show up
  // without a restart. Silent: the current cards stay on screen while it scans.
  useFocusEffect(
    useCallback(() => {
      refresh({ showLoading: false });
    }, [refresh]),
  );

  // The search adapter only covers library categories, so creations are filtered here by the same keyword rule.
  const generatedAssets = useMemo(
    () =>
      filterItemsBySearchKeyword(
        generatedShapes.map(generatedShapeToExploreItem),
        searchKeyword,
      ),
    [generatedShapes, searchKeyword],
  );

  const deleteGeneratedAsset = async (item: ExploreItem) => {
    setDeletingIds((ids) => [...ids, item.id]);
    try {
      await remove(item.id);
      // A favourite would otherwise point at files that no longer exist.
      if (favourites.some((favourite: { id: string }) => favourite.id === item.id)) {
        removeFromFavourites(item);
      }
    } catch (err) {
      Alert.alert(
        "Couldn't delete asset",
        (err as Error)?.message || "Please try again.",
      );
    } finally {
      setDeletingIds((ids) => ids.filter((id) => id !== item.id));
    }
  };

  // Deleting removes files from the device and can't be undone, so it is confirmed first.
  const requestDeleteGeneratedAsset = (item: ExploreItem) => {
    Alert.alert(
      "Delete 3D asset?",
      `"${item.name}" and its files will be removed from this device. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteGeneratedAsset(item),
        },
      ],
    );
  };

  const requestRenameGeneratedAsset = (item: ExploreItem) => {
    setRenameError(null);
    setRenamingAsset(item);
  };

  const cancelRenameGeneratedAsset = () => {
    if (!isRenameSaving) setRenamingAsset(null);
  };

  // The dialog stays open on failure, so the user can fix the name or retry.
  const submitRenameGeneratedAsset = async (name: string) => {
    if (!renamingAsset || isRenameSaving) return;
    const trimmedName = name.trim();
    if (!isGeneratedShapeNameValid(trimmedName)) {
      setRenameError("Name must be between 1 and 200 characters.");
      return;
    }
    setIsRenameSaving(true);
    setRenameError(null);
    try {
      await update(renamingAsset.id, { name: trimmedName });
      setRenamingAsset(null);
    } catch (err) {
      setRenameError(
        (err as Error)?.message || "Couldn't rename asset. Please try again.",
      );
    } finally {
      setIsRenameSaving(false);
    }
  };

  // Content is either the signed-in user's own or the world's (the library). Only the owner may rename or
  // delete an item, so everything else gets no options menu.
  const getItemMenuActions = (item: ExploreItem): MenuAction[] =>
    isItemOwnedByUser(item, user?.id)
      ? [
        {
          id: "rename",
          title: "Rename",
          icon: "pencil",
          onPress: () => requestRenameGeneratedAsset(item),
        },
        {
          id: "delete",
          title: "Delete",
          icon: "trash",
          destructive: true,
          onPress: () => requestDeleteGeneratedAsset(item),
        },
      ]
      : NO_MENU_ACTIONS;

  return {
    sections: categories,
    isLoading: isCategoryLoading,
    generatedAssets,
    isGeneratedAssetsLoading: isGeneratedShapesLoading,
    generatedAssetsError: generatedShapesError,
    deletingIds,
    getItemMenuActions,
    renamingAsset,
    isRenameSaving,
    renameError,
    cancelRenameGeneratedAsset,
    submitRenameGeneratedAsset,
    retryGeneratedAssets: refresh,
  };
};
