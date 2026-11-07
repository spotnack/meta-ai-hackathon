import { ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";

import { AppLogo } from "@/shared/ui/app-logo/app-logo.component";

import { useSignUpViewModel } from "./sign-up.screen.view-model";
import {
  Container,
  SafeAreaContainer,
  TopRow,
  FormSection,
  Title,
  FieldGroup,
  StyledInput,
  CodeInput,
  SubmitGradientBorder,
  SubmitInner,
  SubmitButton,
  SubmitButtonText,
  LinkButton,
  LinkText,
  ErrorText,
  FieldErrorText,
  InfoText,
} from "./sign-up.screen.styles";

/**
 * Sign-up screen: collects user details, then confirms the email verification code.
 * @returns {React.JSX.Element} Sign-up screen.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const vm = useSignUpViewModel();

  return (
    <Container>
      <SafeAreaContainer>
        <TopRow>
          <AppLogo />
        </TopRow>

        <FormSection>
          <Title>{vm.step === "register" ? "Sign up" : "Verify email"}</Title>

          {vm.step === "register" ? (
            <>
              <FieldGroup>
                <StyledInput
                  placeholder="Full name"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={vm.name}
                  onChangeText={vm.setName}
                  autoCapitalize="words"
                  autoComplete="off"
                  $hasError={Boolean(vm.fieldErrors.name)}
                />
                {vm.fieldErrors.name ? <FieldErrorText>{vm.fieldErrors.name}</FieldErrorText> : null}
                <StyledInput
                  placeholder="E-mail"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={vm.email}
                  onChangeText={vm.setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="off"
                  $hasError={Boolean(vm.fieldErrors.email)}
                />
                {vm.fieldErrors.email ? <FieldErrorText>{vm.fieldErrors.email}</FieldErrorText> : null}
                <StyledInput
                  placeholder="Password"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={vm.password}
                  onChangeText={vm.setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  $hasError={Boolean(vm.fieldErrors.password)}
                />
                {vm.fieldErrors.password ? <FieldErrorText>{vm.fieldErrors.password}</FieldErrorText> : null}
              </FieldGroup>

              {vm.error ? <ErrorText>{vm.error}</ErrorText> : null}

              <SubmitButton activeOpacity={0.85} onPress={vm.handleSignUp} disabled={vm.isLoading}>
                <SubmitGradientBorder>
                  <SubmitInner>
                    {vm.isLoading ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <SubmitButtonText>Sign up</SubmitButtonText>
                    )}
                  </SubmitInner>
                </SubmitGradientBorder>
              </SubmitButton>

              <LinkButton onPress={() => router.push("/SignInScreen")}>
                <LinkText>Already have an account?</LinkText>
              </LinkButton>
            </>
          ) : (
            <>
              <InfoText>
                Enter the 6-digit code sent to {vm.destination || vm.email}.
              </InfoText>

              <FieldGroup>
                <CodeInput
                  placeholder="6-digit code"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={vm.code}
                  onChangeText={vm.setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </FieldGroup>

              {vm.error ? <ErrorText>{vm.error}</ErrorText> : null}

              <SubmitButton activeOpacity={0.85} onPress={vm.handleConfirm} disabled={vm.isLoading}>
                <SubmitGradientBorder>
                  <SubmitInner>
                    {vm.isLoading ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <SubmitButtonText>Confirm</SubmitButtonText>
                    )}
                  </SubmitInner>
                </SubmitGradientBorder>
              </SubmitButton>

              <LinkButton onPress={vm.handleResend}>
                <LinkText>Resend code</LinkText>
              </LinkButton>
            </>
          )}
        </FormSection>
      </SafeAreaContainer>
    </Container>
  );
}
