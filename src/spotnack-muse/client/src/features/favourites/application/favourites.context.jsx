/*
Application-layer state for the favourites feature: persisted per-user via
AsyncStorage so favourites survive app restarts and are isolated between
accounts.
*/

// React Dependencies:
import React, { createContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Custom Dependencies:
import { useAuth } from "@features/auth/application/auth.context";

// Creating a global context for the favourites list:
export const FavouritesContext = createContext();

const storageKey = (userId) => `@favourites:${userId}`;

/**
 * Provides per-user favourites state and actions to the component tree.
 * @param {object} root0 - Provider props.
 * @param {React.ReactNode} root0.children - Child components.
 * @returns {React.JSX.Element} Favourites context provider.
 */
export const FavouritesContextProvider = ({ children }) => {
  const { user } = useAuth();
  const [favourites, setFavourites] = useState([]);

  // Load this user's favourites when they sign in. Clear on sign-out.
  useEffect(() => {
    if (!user?.id) {
      setFavourites([]);
      return;
    }
    AsyncStorage.getItem(storageKey(user.id))
      .then((json) => setFavourites(json ? JSON.parse(json) : []))
      .catch(() => setFavourites([]));
  }, [user?.id]);

  const persist = (next, userId) => {
    if (userId) {
      AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(
        () => {},
      );
    }
  };

  const add = (item) => {
    const next = [...favourites, item];
    item.bookmarkCount += 1;
    setFavourites(next);
    persist(next, user?.id);
  };

  const remove = (item) => {
    const next = favourites.filter((x) => x.id !== item.id);
    item.bookmarkCount -= 1;
    setFavourites(next);
    persist(next, user?.id);
  };

  return (
    <FavouritesContext.Provider
      value={{
        favourites,
        addToFavourites: add,
        removeFromFavourites: remove,
      }}
    >
      {children}
    </FavouritesContext.Provider>
  );
};
