/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from "@/shared/theme/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

/**
 * Returns the color tokens for the current light/dark scheme.
 * @returns {object} Active theme color tokens.
 */
export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? "dark" : "light";

  return Colors[theme];
}
