/*
Turns Cognito tokens into the session returned to the app: the verified user
and the tokens themselves. The app stores the tokens (e.g. in expo-secure-store),
sends the access token as `Authorization: Bearer <token>` to protected routes,
and calls POST /api/auth/refresh with the refresh token when it expires.
*/

import { refreshTokens } from "./cognito/cognito.service.js";
import { verifyIdToken } from "./cognito/verifyJwt.js";
import { toPublicUser } from "./user.js";

// Resolves to { user, tokens } once the ID token is verified.
export const toSession = async (tokens) => {
  const claims = await verifyIdToken(tokens.idToken);
  return { user: toPublicUser(claims), tokens };
};

// New ID and access tokens from a refresh token. Rejects when the refresh
// token is revoked or expired: the session is over and the app signs in again.
export const refreshSession = async (refreshToken) => {
  const tokens = await refreshTokens(refreshToken);
  // Without refresh token rotation, Cognito returns no new refresh token: the
  // app keeps using the one it has.
  return toSession({ ...tokens, refreshToken: tokens.refreshToken ?? refreshToken });
};
