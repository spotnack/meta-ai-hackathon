import { useEffect } from "react";
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthContextProvider } from "@features/auth/application/auth.context";
import { FavouritesContextProvider } from "@features/favourites/application/favourites.context";
import { GeneratedShapesContextProvider } from "@features/generated-shapes/application/generated-shapes.context";
import { sweepStaleStorage } from "@features/image-to-3d/infrastructure/storage-sweep";
import { AnimatedSplashOverlay } from "@/shared/ui/animation/animated-logo";

SplashScreen.preventAutoHideAsync();

/**
 * Root layout: wraps the app with context providers and a Stack navigator.
 * @returns {React.JSX.Element} App root layout.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Once per process: drop orphaned conversion job folders and stale module
  // cache dirs. Best-effort (never rejects); never touches a running job.
  useEffect(() => {
    sweepStaleStorage();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AuthContextProvider>
          <FavouritesContextProvider>
            <GeneratedShapesContextProvider>
              <AnimatedSplashOverlay />
              <Stack screenOptions={{ headerShown: false }} />
            </GeneratedShapesContextProvider>
          </FavouritesContextProvider>
        </AuthContextProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
