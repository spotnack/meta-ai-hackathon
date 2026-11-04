import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

/**
 * Handles the deep-link Cognito fires to spotnackmuse://auth/sign-out after the
 * hosted logout page clears the federated (Google / Apple) session. Signals
 * expo-web-browser that the session is done, then sends the user to the auth screen.
 * @returns {React.JSX.Element} Loading spinner shown during the brief transition.
 */
export default function AuthSignOutScreen() {
  const router = useRouter();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
    router.replace("/AuthScreen");
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#ffffff" />
    </View>
  );
}
