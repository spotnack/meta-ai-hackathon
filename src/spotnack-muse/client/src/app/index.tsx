import { useEffect } from "react";
import { useRouter } from "expo-router";

import { useAuth } from "@/features/auth/application/auth.context";

/**
 * Entry point: redirects to the tab navigator if authenticated, otherwise to the auth screen.
 * @returns {React.JSX.Element | null} Nothing while resolving.
 */
export default function IndexRedirect() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user) {
      router.replace("/(tabs)/");
    } else {
      router.replace("/AuthScreen");
    }
  }, [user, isLoading]);

  return null;
}
