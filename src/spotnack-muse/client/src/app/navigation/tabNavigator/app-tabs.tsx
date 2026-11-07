import { Tabs } from "expo-router";
import { Image, useColorScheme } from "react-native";

import { Colors } from "@/shared/theme/theme";
import { useAuth } from "@/features/auth/application/auth.context";

const ICON_SIZE = 24;

/**
 * Renders the bottom tab bar. The profile tab icon shows the signed-in user's Google
 * profile picture as a circle; falls back to the default profile icon when no picture
 * is available.
 * @returns {React.JSX.Element} Tab navigator.
 */
export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === "dark" ? "dark" : "light"];
  const { user } = useAuth();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => (
            <Image
              source={require("@/assets/images/tabIcons/home.png")}
              style={{ width: ICON_SIZE, height: ICON_SIZE, opacity: focused ? 1 : 0.5 }}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ focused }) => (
            <Image
              source={require("@/assets/images/tabIcons/explore.png")}
              style={{ width: ICON_SIZE, height: ICON_SIZE, opacity: focused ? 1 : 0.5 }}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) =>
            user?.picture ? (
              <Image
                source={{ uri: user.picture }}
                style={{
                  width: ICON_SIZE,
                  height: ICON_SIZE,
                  borderRadius: ICON_SIZE / 2,
                  opacity: focused ? 1 : 0.5,
                }}
              />
            ) : (
              <Image
                source={require("@/assets/images/tabIcons/profile.png")}
                style={{
                  width: ICON_SIZE,
                  height: ICON_SIZE,
                  opacity: focused ? 1 : 0.5,
                }}
              />
            ),
        }}
      />
    </Tabs>
  );
}
