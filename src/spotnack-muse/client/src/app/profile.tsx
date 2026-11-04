import { Redirect } from "expo-router";
/**
 * Redirects the bare /profile path to the tab navigator's profile screen.
 * @returns {React.JSX.Element} A redirect element.
 */
export default function ProfileRedirect() {
  return <Redirect href="/(tabs)/profile" />;
}
