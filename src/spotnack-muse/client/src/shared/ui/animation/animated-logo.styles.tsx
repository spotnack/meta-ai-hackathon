// Styles for AnimatedLogo() component.

import { Image } from "expo-image";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import styled, { css } from "styled-components/native";

const absoluteFill = css`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
`;

const glowBase = css`
  width: 163px;
  height: 163px;
  position: absolute;
`;

export const IconContainer = styled(View)`
  justify-content: center;
  align-items: center;
  width: 130px;
  height: 130px;
  z-index: 100;
`;

export const GlowContainer = styled(Animated.View)`
  ${glowBase}
`;

export const GlowImage = styled(Image)`
  ${glowBase}
`;

export const Background = styled(Animated.View).attrs({
  style: { experimental_backgroundImage: "transparent" },
})`
  border-radius: 40px;
  width: 128px;
  height: 128px;
  position: absolute;
`;

export const LogoContainer = styled(Animated.View)`
  justify-content: center;
  align-items: center;
`;

export const LogoImage = styled(Image)`
  width: 100px;
  height: 137px;
`;

const splashBase = css`
  ${absoluteFill}
  background-color: #208aef;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

export const SplashBackground = styled(View)`
  ${splashBase}
`;

export const AnimatedSplashBackground = styled(Animated.View)`
  ${splashBase}
`;
