import { createContext, useContext, useState, type ReactNode } from "react";
import * as WebBrowser from "expo-web-browser";
import * as ExpoCrypto from "expo-crypto";

import {
  authApi,
  type AuthUser,
  type AuthTokens,
  type AuthSession,
} from "../infrastructure/auth.api";

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  user: AuthUser | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{ destination: string }>;
  confirmSignUp: (
    email: string,
    code: string,
    password: string,
  ) => Promise<void>;
  resendCode: (email: string) => Promise<{ destination: string }>;
  signInWithGoogle: () => Promise<boolean>;
  signInWithApple: () => Promise<boolean>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Generates a cryptographically random RFC 7636 PKCE code verifier.
 * @returns {Promise<string>} 96-character URL-safe verifier string.
 */
async function generateCodeVerifier(): Promise<string> {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = await ExpoCrypto.getRandomBytesAsync(96);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Derives a RFC 7636 S256 code challenge from a verifier.
 * @param {string} verifier - The PKCE code verifier.
 * @returns {Promise<string>} Base64url-encoded SHA-256 hash of the verifier.
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  // digestStringAsync returns base64 by default. Convert to base64url.
  const base64 = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: ExpoCrypto.CryptoEncoding.BASE64 },
  );
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Extracts a single query parameter value from a URL string.
 * @param {string} url - The URL to parse.
 * @param {string} param - The parameter name to extract.
 * @returns {string | null} Decoded value, or null if absent.
 */
function extractQueryParam(url: string, param: string): string | null {
  const match = url.match(new RegExp(`[?&#]${param}=([^&#]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Opens the Cognito Hosted UI for the given identity provider and exchanges
 * the returned authorization code for an auth session via PKCE.
 * @param {"Google" | "SignInWithApple"} identityProvider - The federated provider.
 * @returns {Promise<AuthSession | null>} Session on success, null if cancelled.
 */
async function federatedSignIn(
  identityProvider: "Google" | "SignInWithApple",
): Promise<AuthSession | null> {
  const config = await authApi.getConfig();
  if (!config.google || !config.hostedUi) {
    throw new Error("Federated sign-in is not configured on this server.");
  }
  const { domain, clientId, redirectUri, scopes } = config.hostedUi;

  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    identity_provider: identityProvider,
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authorizeUrl = `${domain}/oauth2/authorize?${params}`;
  console.log("[auth] Opening:", authorizeUrl);

  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);
  console.log("[auth] openAuthSessionAsync result:", JSON.stringify(result));

  if (result.type !== "success") return null;

  const code = extractQueryParam(result.url, "code");
  const errorParam = extractQueryParam(result.url, "error");
  console.log("[auth] code:", code ? "present" : "absent", "error:", errorParam);
  if (!code) return null;

  return authApi.googleToken({ code, codeVerifier: verifier, redirectUri });
}

/**
 * Provides authentication state and actions to the component tree.
 * @param {object} root0 - Provider props.
 * @param {ReactNode} root0.children - Child components.
 * @returns {React.JSX.Element} Auth context provider.
 */
export function AuthContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    tokens: null,
    isLoading: false,
  });

  const setSession = ({ user, tokens }: AuthSession) => {
    setState({ user, tokens, isLoading: false });
  };

  const withLoading = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      return await fn();
    } finally {
      setState((s) => (s.isLoading ? { ...s, isLoading: false } : s));
    }
  };

  const signIn = (email: string, password: string) =>
    withLoading(async () => {
      setSession(await authApi.signIn({ email, password }));
    });

  const signUp = (name: string, email: string, password: string) =>
    withLoading(() =>
      authApi.signUp({ name, email, password, acceptTerms: true }),
    );

  const confirmSignUp = (email: string, code: string, password: string) =>
    withLoading(async () => {
      await authApi.confirmSignUp({ email, code });
      setSession(await authApi.signIn({ email, password }));
    });

  const resendCode = (email: string) =>
    withLoading(() => authApi.resendCode({ email }));

  const signInWithGoogle = (): Promise<boolean> =>
    withLoading(async () => {
      const session = await federatedSignIn("Google");
      if (session) {
        setSession(session);
        return true;
      }
      return false;
    });

  const signInWithApple = (): Promise<boolean> =>
    withLoading(async () => {
      const session = await federatedSignIn("SignInWithApple");
      if (session) {
        setSession(session);
        return true;
      }
      return false;
    });

  const signOut = () =>
    withLoading(async () => {
      const provider = state.user?.provider;
      const result = await authApi.signOut(state.tokens?.refreshToken);
      setState({ user: null, tokens: null, isLoading: false });
      // Only open the hosted logout page for federated (Google/Apple) users so
      // their Cognito session is fully cleared and the provider prompts again.
      if (result.logoutUrl && provider && provider !== "cognito") {
        WebBrowser.openBrowserAsync(result.logoutUrl);
      }
    });

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signIn,
        signUp,
        confirmSignUp,
        resendCode,
        signInWithGoogle,
        signInWithApple,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Returns the current auth state and actions.
 * @returns {AuthContextValue} Auth context value.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthContextProvider");
  return ctx;
}
