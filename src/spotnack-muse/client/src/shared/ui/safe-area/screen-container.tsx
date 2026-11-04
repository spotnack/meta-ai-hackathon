// src/shared/ui/screen-container.tsx
import { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";

interface SafeScreenContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Full-screen safe-area wrapper that applies the theme background and bottom tab offset.
 * @param {SafeScreenContainerProps} root0 - Component props.
 * @returns {React.JSX.Element} Themed safe area container.
 */
export function SafeScreenContainer({
  children,
  style,
}: SafeScreenContainerProps) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[
        {
          flex: 1,
          backgroundColor: theme.background,
          paddingBottom: 0,
        },
        style,
      ]}
    >
      {children}
    </SafeAreaView>
  );
}
