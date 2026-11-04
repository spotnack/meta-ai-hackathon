import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { AnimatedLogo } from "@/shared/ui/animation/animated-logo";

import {
  Container,
  HeroSection,
  HeroText,
  ButtonGroup,
  SignInButton,
  SignInButtonText,
  SignUpButton,
  SignUpGradient,
  SignUpButtonText,
} from "./auth.screen.styles";

/**
 * Landing auth screen with sign-in and sign-up entry points.
 * @returns {React.JSX.Element} Auth screen.
 */
export default function AuthScreen() {
  const router = useRouter();

  return (
    <Container>
      <SafeAreaView style={{ flex: 1 }}>
        <HeroSection>
          <AnimatedLogo />
          <HeroText>Where The Journey Begins</HeroText>

          <ButtonGroup>
            <SignInButton
              activeOpacity={0.8}
              onPress={() => router.push("/SignInScreen")}
            >
              <SignInButtonText>Sign in</SignInButtonText>
            </SignInButton>

            <SignUpButton
              activeOpacity={0.8}
              onPress={() => router.push("/SignUpScreen")}
            >
              <SignUpGradient>
                <SignUpButtonText>Sign up</SignUpButtonText>
              </SignUpGradient>
            </SignUpButton>
          </ButtonGroup>
        </HeroSection>
      </SafeAreaView>
    </Container>
  );
}
