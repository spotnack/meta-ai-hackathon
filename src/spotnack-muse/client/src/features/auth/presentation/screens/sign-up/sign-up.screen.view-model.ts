import { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/features/auth/application/auth.context";
import { ValidationError } from "@/features/auth/infrastructure/auth.api";

type Step = "register" | "confirm";

/**
 * ViewModel for the sign-up screen.
 * Owns all UI state, multi-step flow logic, and post-auth navigation.
 * @returns {object} State and handlers consumed by SignUpScreen.
 */
export function useSignUpViewModel() {
  const router = useRouter();
  const { signUp, confirmSignUp, resendCode, isLoading } = useAuth();

  const [step, setStep] = useState<Step>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSignUp = async () => {
    setError("");
    setFieldErrors({});
    if (!name.trim() || !email.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }
    try {
      const result = await signUp(name.trim(), email.trim().toLowerCase(), password);
      if (result.confirmed) {
        router.replace("/(tabs)/");
      } else {
        setDestination(result.destination);
        setStep("confirm");
      }
    } catch (e) {
      if (e instanceof ValidationError) {
        setFieldErrors(e.fields);
      } else {
        setError((e as Error).message);
      }
    }
  };

  const handleConfirm = async () => {
    setError("");
    if (!code.trim()) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    try {
      await confirmSignUp(email.trim().toLowerCase(), code.trim(), password);
      router.replace("/(tabs)/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleResend = async () => {
    try {
      await resendCode(email.trim().toLowerCase());
      Alert.alert("Code resent", `A new code was sent to ${destination || email}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return {
    step,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    code,
    setCode,
    destination,
    error,
    fieldErrors,
    isLoading,
    handleSignUp,
    handleConfirm,
    handleResend,
  };
}
