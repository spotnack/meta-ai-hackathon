import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { useAuth } from "@/features/auth/application/auth.context";

/**
 * Landing screen shown briefly after Google sign-in redirects back to the app.
 * Waits for the sign-in to finish, then sends the user to the home screen or
 * back to the login screen if something went wrong.
 * @returns {React.JSX.Element} Loading spinner shown while the auth context completes sign-in.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { error } = useLocalSearchParams<{ error?: string }>();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (user) {
      router.replace("/(tabs)/");
    } else if (error) {
      router.replace("/AuthScreen");
    }
  }, [user, isLoading, error]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#000000",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator color="#ffffff" />
    </View>
  );
}
