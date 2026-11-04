import { Redirect } from "expo-router";

import { useAuth } from "@/features/auth/application/auth.context";
import AppTabs from "@/app/navigation/tabNavigator/app-tabs";

/**
 * Tab navigator layout for the main app tabs.
 * Redirects unauthenticated users to the auth screen.
 * @returns {React.JSX.Element} The tab navigator, or a redirect.
 */
export default function TabsLayout() {
  const { user, isLoading } = useAuth();

  if (!user && !isLoading) return <Redirect href="/AuthScreen" />;

  return <AppTabs />;
}
