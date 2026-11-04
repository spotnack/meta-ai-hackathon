import { Redirect } from "expo-router";
/**
 * Redirects the bare /explore path to the tab navigator's explore screen.
 * @returns {React.JSX.Element} A redirect element.
 */
export default function ExploreRedirect() {
  return <Redirect href="/(tabs)/explore" />;
}
