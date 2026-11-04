import { ActivityIndicator } from "react-native";

import { AppLogo } from "@/shared/ui/app-logo/app-logo.component";

import {
  Container,
  SafeAreaContainer,
  TopRow,
  FormSection,
  Title,
  StyledInput,
  SubmitButton,
  SubmitButtonText,
  LinkButton,
  LinkText,
  ErrorText,
  FieldErrorText,
  INPUT_ERROR_STYLE,
} from "./pass-reset.screen.styles";
import { usePassResetViewModel } from "./pass-reset.screen.view-model";

/**
 * Forgot-password screen: requests a reset code, then lets the user set a new password.
 * @returns {React.JSX.Element} Forgot-password screen.
 */
export function ForgotPasswordScreen() {
  const vm = usePassResetViewModel();

  return (
    <Container>
      <SafeAreaContainer>
        <TopRow>
          <AppLogo />
        </TopRow>
        <FormSection>
          <Title>
            {vm.step === "request" ? "Reset password" : "Set new password"}
          </Title>

          {vm.step === "request" ? (
            <>
              <StyledInput
                style={vm.fieldErrors.email ? INPUT_ERROR_STYLE : undefined}
                placeholder="E-mail"
                value={vm.email}
                onChangeText={vm.setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="off"
              />
              {vm.fieldErrors.email ? (
                <FieldErrorText>{vm.fieldErrors.email}</FieldErrorText>
              ) : null}
            </>
          ) : (
            <>
              <StyledInput
                style={vm.fieldErrors.code ? INPUT_ERROR_STYLE : undefined}
                placeholder="6-digit code"
                value={vm.code}
                onChangeText={vm.setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              {vm.fieldErrors.code ? (
                <FieldErrorText>{vm.fieldErrors.code}</FieldErrorText>
              ) : null}
              <StyledInput
                style={vm.fieldErrors.password ? INPUT_ERROR_STYLE : undefined}
                placeholder="New password"
                value={vm.password}
                onChangeText={vm.setPassword}
                secureTextEntry
              />
              {vm.fieldErrors.password ? (
                <FieldErrorText>{vm.fieldErrors.password}</FieldErrorText>
              ) : null}
            </>
          )}

          {vm.error ? <ErrorText>{vm.error}</ErrorText> : null}

          <SubmitButton
            onPress={vm.step === "request" ? vm.handleRequest : vm.handleReset}
            disabled={vm.loading}
            activeOpacity={0.85}
          >
            {vm.loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <SubmitButtonText>
                {vm.step === "request" ? "Send reset code" : "Update password"}
              </SubmitButtonText>
            )}
          </SubmitButton>

          <LinkButton onPress={vm.handleBack}>
            <LinkText>Back to sign in</LinkText>
          </LinkButton>
        </FormSection>
      </SafeAreaContainer>
    </Container>
  );
}
