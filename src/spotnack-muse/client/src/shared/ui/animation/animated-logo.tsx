// View layer: includes JSX/TSX components.

import * as SplashScreen from "expo-splash-screen";
import { useState } from "react";
import { Dimensions } from "react-native";
import { Easing, Keyframe } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
  AnimatedSplashBackground,
  Background,
  GlowContainer,
  GlowImage,
  IconContainer,
  LogoContainer,
  LogoImage,
  SplashBackground,
} from "./animated-logo.styles";

const INITIAL_SCALE_FACTOR = Dimensions.get("screen").height / 90;
const DURATION = 600;

const keyframe = new Keyframe({
  0: {
    transform: [{ scale: INITIAL_SCALE_FACTOR }],
  },
  100: {
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const logoKeyframe = new Keyframe({
  0: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
  },
  40: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
    easing: Easing.elastic(0.7),
  },
  100: {
    opacity: 1,
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const glowKeyframe = new Keyframe({
  0: {
    transform: [{ rotateZ: "0deg" }],
  },
  100: {
    transform: [{ rotateZ: "7200deg" }],
  },
});

/**
 * Animated overlay that mirrors the native splash screen and fades out on mount.
 * @returns {React.JSX.Element | null} Splash overlay, or null once dismissed.
 */
export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const image = <LogoImage source={require("@/assets/images/icon.png")} />;

  return animate ? (
    <AnimatedSplashBackground
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        "worklet";
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
    >
      {image}
    </AnimatedSplashBackground>
  ) : (
    <SplashBackground
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
    >
      {image}
    </SplashBackground>
  );
}

/**
 * Animated app logo with a spinning glow effect and an elastic scale entrance.
 * @returns {React.JSX.Element} Animated logo component
 */
export function AnimatedLogo() {
  return (
    <IconContainer>
      <GlowContainer entering={glowKeyframe.duration(60 * 1000 * 4)}>
        <GlowImage source={require("@/assets/images/logo-glow.png")} />
      </GlowContainer>

      <Background entering={keyframe.duration(DURATION)} />

      <LogoContainer entering={logoKeyframe.duration(DURATION)}>
        <LogoImage source={require("@/assets/images/icon.png")} />
      </LogoContainer>
    </IconContainer>
  );
}
