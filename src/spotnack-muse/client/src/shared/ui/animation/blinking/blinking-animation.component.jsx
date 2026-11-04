// React Dependencies
import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";

// Styles
import { BlinkingAnimationWrapper } from "./blinking-animation.component.styles";

// Component
export const BlinkingAnimation = ({ children }) => {
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const blink = () => {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => blink());
    };

    blink();
  }, [fadeAnim]);

  return (
    <BlinkingAnimationWrapper style={{ opacity: fadeAnim }}>
      {children}
    </BlinkingAnimationWrapper>
  );
};
