/*
Amazon Cognito user pool operations (AWS SDK v3), used by the auth routes.

The app client is public (no client secret) and these are unauthenticated
Cognito APIs, so the server needs no AWS credentials for them.
*/

import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { authConfig } from "../../config/auth.config.js";
import {
  AuthError,
  misconfiguredError,
  toAuthError,
} from "./cognito.errors.js";

const sanitizeForLog = (value) =>
  String(value ?? "").replace(/[\r\n\t]/g, " ").slice(0, 200);

let cognitoClient;
const getClient = () => {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({
      region: authConfig.region,
    });
  }
  return cognitoClient;
};

const send = async (command) => {
  try {
    return await getClient().send(command);
  } catch (error) {
    throw toAuthError(error);
  }
};

// { IdToken, AccessToken, RefreshToken?, ExpiresIn } -> camelCase tokens.
const toTokens = (result) => ({
  idToken: result.IdToken,
  accessToken: result.AccessToken,
  refreshToken: result.RefreshToken,
  expiresIn: result.ExpiresIn,
});

// Registration ---------------------------------------------------------------

export const signUp = async ({ name, email, password }) => {
  const result = await send(
    new SignUpCommand({
      ClientId: authConfig.clientId,
      Username: email, // The pool uses the email as the sign-in name.
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name", Value: name },
      ],
    }),
  );

  return {
    confirmed: Boolean(result.UserConfirmed),
    // Masked address the code was sent to, e.g. "a***@e***":
    destination: result.CodeDeliveryDetails?.Destination || "",
  };
};

export const confirmSignUp = ({ email, code }) =>
  send(
    new ConfirmSignUpCommand({
      ClientId: authConfig.clientId,
      Username: email,
      ConfirmationCode: code,
    }),
  );

export const resendConfirmationCode = async ({ email }) => {
  const result = await send(
    new ResendConfirmationCodeCommand({
      ClientId: authConfig.clientId,
      Username: email,
    }),
  );
  return { destination: result.CodeDeliveryDetails?.Destination || "" };
};

// Authentication ------------------------------------------------------------

export const signInWithPassword = async ({ email, password }) => {
  const result = await send(
    new InitiateAuthCommand({
      ClientId: authConfig.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );

  if (!result.AuthenticationResult) {
    // e.g. NEW_PASSWORD_REQUIRED or MFA, which this app does not enable.
    console.warn("[auth] Unsupported sign-in challenge:", result.ChallengeName);
    throw new AuthError(
      403,
      "UNSUPPORTED_CHALLENGE",
      "This account needs an extra sign-in step that is not supported yet.",
    );
  }
  return toTokens(result.AuthenticationResult);
};

export const refreshTokens = async (refreshToken) => {
  const result = await send(
    new InitiateAuthCommand({
      ClientId: authConfig.clientId,
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  );
  // Without refresh token rotation, Cognito keeps the same refresh token.
  return toTokens(result.AuthenticationResult);
};

// Revokes the refresh token and the access tokens issued from it.
export const revokeRefreshToken = (refreshToken) =>
  send(
    new RevokeTokenCommand({
      ClientId: authConfig.clientId,
      Token: refreshToken,
    }),
  );

// Password reset ------------------------------------------------------------

// Emails a 6-digit reset code. Unknown emails (and accounts that can't reset,
// e.g. without a verified email) get the same answer as real ones, so the API
// does not reveal which emails have an account.
export const forgotPassword = async ({ email }) => {
  try {
    const result = await send(
      new ForgotPasswordCommand({
        ClientId: authConfig.clientId,
        Username: email,
      }),
    );
    return { destination: result.CodeDeliveryDetails?.Destination || "" };
  } catch (error) {
    if (
      error.code === "INVALID_CREDENTIALS" ||
      error.code === "INVALID_REQUEST"
    ) {
      console.warn(`[auth] Password reset not sent (${error.code}).`);
      return { destination: "" };
    }
    throw error;
  }
};

// Sets the new password. An unknown email reads as a wrong code (same reason).
export const confirmForgotPassword = async ({ email, code, password }) => {
  try {
    await send(
      new ConfirmForgotPasswordCommand({
        ClientId: authConfig.clientId,
        Username: email,
        ConfirmationCode: code,
        Password: password,
      }),
    );
  } catch (error) {
    if (error.code === "INVALID_CREDENTIALS") {
      throw new AuthError(
        400,
        "INVALID_CODE",
        "The verification code is incorrect.",
      );
    }
    throw error;
  }
};

// Federated sign-in (Google through the Cognito hosted login) ---------------

// The app runs the hosted login itself (expo-auth-session, with PKCE); this
// exchanges the authorization code it got at the Cognito OAuth 2.0 token
// endpoint.
export const exchangeAuthorizationCode = async ({
  code,
  codeVerifier,
  redirectUri = authConfig.redirectUri,
}) => {
  let response;
  try {
    response = await fetch(`${authConfig.domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: authConfig.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
  } catch (error) {
    console.error("[auth] Token endpoint unreachable:", error.message);
    throw new AuthError(502, "TOKEN_EXCHANGE_FAILED", "Google sign-in failed.");
  }

  const body = await response.json().catch(() => ({}));
  if (body.error === "invalid_client") {
    throw misconfiguredError(
      "the Cognito app client has a client secret, so the token endpoint rejects the public client. Create a public app client (type: Mobile app, no secret) and set COGNITO_CLIENT_ID.",
    );
  }
  if (!response.ok || !body.id_token || !body.access_token) {
    console.error("[auth] Token exchange failed:", response.status, sanitizeForLog(body.error));
    throw new AuthError(401, "TOKEN_EXCHANGE_FAILED", "Google sign-in failed.");
  }

  return {
    idToken: body.id_token,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
  };
};

// Ends the hosted-login session too, so "Continue with Google" asks again.
export const getHostedSignOutUrl = () => {
  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    logout_uri: authConfig.signOutUri,
  });
  return `${authConfig.domain}/logout?${params}`;
};
