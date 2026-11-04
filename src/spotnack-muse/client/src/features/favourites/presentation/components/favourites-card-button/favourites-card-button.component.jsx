// React Dependencies
import React from "react";

// Icons
import { FavouritesCardIcon } from "@features/favourites/presentation/components/favourites-icon/favourites-icon.component";

// Custom Styles
import { FavouritesCardButtonStyle } from "./favourites-card-button.component.styles";

/*
Pure presentational toggle: rendering only, no context/data-fetching of its
own (props in, JSX out). The caller (e.g. the explore card) already knows
whether `item` is a favourite and how to toggle it, so it passes both down
rather than this component re-deriving them from FavouritesContext itself.
*/
export const FavouritesCardButton = ({ isFavourite, onToggle }) => (
  <FavouritesCardButtonStyle onPress={onToggle}>
    <FavouritesCardIcon name={isFavourite ? "bookmark-alt" : "bookmark"} />
  </FavouritesCardButtonStyle>
);
