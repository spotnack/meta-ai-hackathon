import { useState } from "react";
import { useRouter } from "expo-router";

import { useAuth } from "@/features/auth/application/auth.context";
import { ValidationError } from "@/features/auth/infrastructure/auth.api";

/**
 * ViewModel for the sign-in screen.
 * Owns all UI state, event handlers, and post-auth navigation.
 * @returns {object} State and handlers consumed by SignInScreen.
 */
export function useSignInViewModel() {
  const router = useRouter();
  const { signIn, signInWithGoogle, signInWithApple, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSignIn = async () => {
    setError("");
    setFieldErrors({});
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace("/(tabs)/");
    } catch (e) {
      if (e instanceof ValidationError) {
        setFieldErrors(e.fields);
      } else {
        setError((e as Error).message);
      }
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      const ok = await signInWithGoogle();
      if (ok) router.replace("/(tabs)/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleApple = async () => {
    setError("");
    try {
      const ok = await signInWithApple();
      if (ok) router.replace("/(tabs)/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    error,
    fieldErrors,
    isLoading,
    handleSignIn,
    handleGoogle,
    handleApple,
  };
}
