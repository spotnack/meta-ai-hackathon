import { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";

import {
  authApi,
  ValidationError,
} from "@/features/auth/infrastructure/auth.api";

type Step = "request" | "reset";

/**
 * State, handlers, and navigation for the forgot/reset-password flow.
 * @returns {{ step: string, email: string, setEmail: function(string): void, code: string, setCode: function(string): void, password: string, setPassword: function(string): void, loading: boolean, error: string, fieldErrors: object, handleRequest: function(): Promise<void>, handleReset: function(): Promise<void>, handleBack: function(): void }} View model state and actions.
 */
export function usePassResetViewModel() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleRequest = async () => {
    setError("");
    setFieldErrors({});
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.forgotPassword({
        email: email.trim().toLowerCase(),
      });
      if (!result.destination) {
        setError(
          "This email address is not registered. Please check your spelling or sign up for a new account.",
        );
        return;
      }
      setStep("reset");
    } catch (e) {
      if (e instanceof ValidationError) {
        setFieldErrors(e.fields);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setError("");
    setFieldErrors({});
    if (!code.trim() || !password) {
      setError("Fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        password,
      });
      Alert.alert(
        "Password reset",
        "Your password has been updated. Please sign in.",
        [{ text: "Sign in", onPress: () => router.replace("/SignInScreen") }],
      );
    } catch (e) {
      if (e instanceof ValidationError) {
        setFieldErrors(e.fields);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => router.back();

  return {
    step,
    email,
    setEmail,
    code,
    setCode,
    password,
    setPassword,
    loading,
    error,
    fieldErrors,
    handleRequest,
    handleReset,
    handleBack,
  };
}
