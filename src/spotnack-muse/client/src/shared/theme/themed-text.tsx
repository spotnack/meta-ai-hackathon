import { Platform, StyleSheet, Text, type TextProps } from "react-native";

import { Fonts, ThemeColor } from "@/shared/theme/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  type?:
    | "default"
    | "label"
    | "small"
    | "smallBold"
    | "title"
    | "subtitle"
    | "link"
    | "linkPrimary"
    | "code";
  themeColor?: ThemeColor;
};

/**
 * Text component that applies the current theme color and a predefined type scale.
 * @param {ThemedTextProps} root0 - Component props.
 * @param {string} [root0.type] - Text scale variant.
 * @param {ThemeColor} [root0.themeColor] - Theme color key.
 * @returns {React.JSX.Element} Themed text element.
 */
export function ThemedText({
  style,
  type = "default",
  themeColor,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[{ color: theme[themeColor ?? "text"] }, styles[type], style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  label: {
    fontSize: 18,
    lineHeight: 16,
    fontWeight: 700,
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  title: {
    fontSize: 35,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: "#3c87f7",
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
