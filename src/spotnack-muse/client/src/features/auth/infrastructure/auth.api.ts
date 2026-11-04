import { getApiBaseUrl } from "@/config/api";

/** Error thrown when the server returns field-level validation failures. */
export class ValidationError extends Error {
  fields: Record<string, string>;
  /**
   * @param {Record<string, string>} fields - Map of field name to error message.
   */
  constructor(fields: Record<string, string>) {
    super("Please check the highlighted fields.");
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider?: string;
};

export type AuthTokens = {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export type AuthSession = { user: AuthUser; tokens: AuthTokens };

export type HostedUiConfig = {
  domain: string;
  clientId: string;
  redirectUri: string;
  signOutUri: string;
  scopes: string[];
};

export type AuthConfigResponse = {
  enabled: boolean;
  google: boolean;
  hostedUi: HostedUiConfig | null;
};

/**
 * Sends a JSON request to the auth API and throws on non-2xx responses.
 * @template T - Expected response shape.
 * @param {string} path - Path appended to the base auth URL.
 * @param {object} [body] - Request body (omit for GET).
 * @param {string} [method] - HTTP method, defaults to POST.
 * @returns {Promise<T>} Parsed response body.
 */
async function callApi<T>(path: string, body?: object, method = "POST"): Promise<T> {
  const url = `${getApiBaseUrl()}/auth${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    if (data.code === "VALIDATION_ERROR" && data.fields) {
      throw new ValidationError(data.fields as Record<string, string>);
    }
    throw new Error((data.message as string | undefined) ?? "Request failed");
  }
  return data as T;
}

export const authApi = {
  getConfig: () => callApi<AuthConfigResponse>("/config", undefined, "GET"),

  signUp: (body: { name: string; email: string; password: string; acceptTerms: true }) =>
    callApi<{ confirmed: boolean; destination: string }>("/sign-up", body),

  confirmSignUp: (body: { email: string; code: string }) =>
    callApi<{ confirmed: boolean }>("/confirm-sign-up", body),

  resendCode: (body: { email: string }) =>
    callApi<{ destination: string }>("/resend-code", body),

  signIn: (body: { email: string; password: string }) =>
    callApi<AuthSession>("/sign-in", body),

  googleToken: (body: { code: string; codeVerifier: string; redirectUri?: string }) =>
    callApi<AuthSession>("/google/token", body),

  refresh: (refreshToken: string) =>
    callApi<AuthSession>("/refresh", { refreshToken }),

  forgotPassword: (body: { email: string }) =>
    callApi<{ destination: string }>("/forgot-password", body),

  resetPassword: (body: { email: string; code: string; password: string }) =>
    callApi<{ reset: boolean }>("/reset-password", body),

  signOut: (refreshToken?: string) =>
    callApi<{ signedOut: boolean; logoutUrl?: string }>("/sign-out", { refreshToken }),
};
