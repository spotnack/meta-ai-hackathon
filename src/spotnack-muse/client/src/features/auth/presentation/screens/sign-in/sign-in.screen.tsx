import { ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { FontAwesome, FontAwesome6 } from "@expo/vector-icons";

import { AppLogo } from "@/shared/ui/app-logo/app-logo.component";

import { useSignInViewModel } from "./sign-in.screen.view-model";
import {
  Container,
  SafeAreaContainer,
  TopRow,
  FormSection,
  Title,
  SocialGroup,
  SocialButton,
  SocialButtonText,
  DividerRow,
  DividerLine,
  DividerText,
  FieldGroup,
  StyledInput,
  SubmitGradientBorder,
  SubmitInner,
  SubmitButton,
  SubmitButtonText,
  LinkRow,
  LinkButton,
  LinkText,
  ErrorText,
  FieldErrorText,
} from "./sign-in.screen.styles";

/**
 * Sign-in screen: email/password login and federated (Google, Apple) sign-in.
 * @returns {React.JSX.Element} Sign-in screen.
 */
export default function SignInScreen() {
  const router = useRouter();
  const vm = useSignInViewModel();

  return (
    <Container>
      <SafeAreaContainer>
        <TopRow>
          <AppLogo />
        </TopRow>

        <FormSection>
          <Title>Sign in</Title>

          <SocialGroup>
            <SocialButton
              activeOpacity={0.75}
              onPress={vm.handleGoogle}
              disabled={vm.isLoading}
            >
              <FontAwesome name="google" size={18} color="#ffffff" />
              <SocialButtonText>Sign in with Google</SocialButtonText>
            </SocialButton>
            {/*
            <SocialButton activeOpacity={0.75} onPress={vm.handleApple} disabled={vm.isLoading}>
              <FontAwesome6 name="apple" size={18} color="#ffffff" />
              <SocialButtonText>Sign in with Apple</SocialButtonText>
            </SocialButton>
            */}
          </SocialGroup>

          <DividerRow>
            <DividerLine />
            <DividerText>Or</DividerText>
            <DividerLine />
          </DividerRow>

          <FieldGroup>
            <StyledInput
              placeholder="E-mail or username"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={vm.email}
              onChangeText={vm.setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="off"
              $hasError={Boolean(vm.fieldErrors.email)}
            />
            {vm.fieldErrors.email ? (
              <FieldErrorText>{vm.fieldErrors.email}</FieldErrorText>
            ) : null}
            <StyledInput
              placeholder="Password"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={vm.password}
              onChangeText={vm.setPassword}
              secureTextEntry
              autoComplete="password"
              $hasError={Boolean(vm.fieldErrors.password)}
            />
            {vm.fieldErrors.password ? (
              <FieldErrorText>{vm.fieldErrors.password}</FieldErrorText>
            ) : null}
          </FieldGroup>

          {vm.error ? <ErrorText>{vm.error}</ErrorText> : null}

          <SubmitButton
            activeOpacity={0.85}
            onPress={vm.handleSignIn}
            disabled={vm.isLoading}
          >
            <SubmitGradientBorder>
              <SubmitInner>
                {vm.isLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <SubmitButtonText>Log in</SubmitButtonText>
                )}
              </SubmitInner>
            </SubmitGradientBorder>
          </SubmitButton>

          <LinkRow>
            <LinkButton onPress={() => router.push("/ForgotPasswordScreen")}>
              <LinkText>Forgot password?</LinkText>
            </LinkButton>

            <LinkButton onPress={() => router.push("/SignUpScreen")}>
              <LinkText>Create new account</LinkText>
            </LinkButton>
          </LinkRow>
        </FormSection>
      </SafeAreaContainer>
    </Container>
  );
}
