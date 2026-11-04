import { View, type ViewProps } from "react-native";

import { ThemeColor } from "@/shared/theme/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

/**
 * View component that applies a background color from the current theme.
 * @param {ThemedViewProps} root0 - Component props.
 * @param {string} [root0.lightColor] - Override background in light mode.
 * @param {string} [root0.darkColor] - Override background in dark mode.
 * @param {ThemeColor} [root0.type] - Theme color key for background.
 * @returns {React.JSX.Element} Themed view element.
 */
export function ThemedView({
  style,
  lightColor,
  darkColor,
  type,
  ...otherProps
}: ThemedViewProps) {
  const theme = useTheme();

  return (
    <View
      style={[{ backgroundColor: theme[type ?? "background"] }, style]}
      {...otherProps}
    />
  );
}
