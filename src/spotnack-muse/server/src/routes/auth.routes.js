/*
Authentication API (mounted at /api/auth) for the mobile app, backed by an
Amazon Cognito user pool: registration with email verification, email/password
sign-in, password reset, Google sign-in (federated through the Cognito hosted
login), token refresh and sign-out.

Sign-in, Google sign-in and refresh respond with `{ user, tokens }`; the app
stores the tokens securely and sends the access token as
`Authorization: Bearer <token>` to protected routes (see requireAuth).

Google sign-in: the app opens the hosted login with expo-auth-session (using
`hostedUi` from GET /config, `extraParams: { identity_provider: "Google" }` and
PKCE), then posts the returned code and its PKCE verifier to /google/token.
*/

import express from "express";

import {
  authConfig,
  isAuthConfigured,
  isGoogleSignInConfigured,
} from "../config/auth.config.js";
import {
  confirmForgotPassword,
  confirmSignUp,
  exchangeAuthorizationCode,
  forgotPassword,
  getHostedSignOutUrl,
  resendConfirmationCode,
  revokeRefreshToken,
  signInWithPassword,
  signUp,
} from "../auth/cognito/cognito.service.js";
import { toAuthError } from "../auth/cognito/cognito.errors.js";
import { refreshSession, toSession } from "../auth/session.js";
import {
  requireJson,
  validateBody,
} from "../middlewares/auth.security.middleware.js";
import {
  confirmSignUpSchema,
  forgotPasswordSchema,
  googleTokenSchema,
  refreshSchema,
  resendCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signOutSchema,
  signUpSchema,
} from "../validators/auth.validators.js";

// Express 4 does not catch rejected promises from async handlers:
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Google users whose ID token has no `picture` (logged once per user): the
// Cognito Google provider is missing the picture mapping or read permission.
const warnedMissingPicture = new Set();
const checkGooglePicture = (user) => {
  if (
    user?.provider !== "google" ||
    user.picture ||
    warnedMissingPicture.has(user.id)
  ) {
    return;
  }
  warnedMissingPicture.add(user.id);
  console.warn(
    "[auth] Google user without a profile picture: map the Google attribute `picture` to `picture`, include the `profile` scope, and allow reading `picture` on the app client. Then sign in again.",
  );
};

// `enrichUser(user, { fresh })` adds the application's own data to the
// signed-in user (e.g. the subscription plan); `fresh` asks it to skip its
// cache. Without it, users are returned as Cognito describes them.
export const createAuthRouter = ({
  enrichUser = async (user) => user,
} = {}) => {
  const router = express.Router();

  const respondWithSession = async (
    res,
    { user, tokens },
    { fresh = false } = {},
  ) => res.json({ user: await enrichUser(user, { fresh }), tokens });

  // Auth responses must never be cached:
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // Which sign-in options are available, and what the app needs to open the
  // Cognito hosted login for Google (public identifiers, not secrets).
  router.get("/config", (req, res) => {
    res.json({
      enabled: isAuthConfigured,
      google: isGoogleSignInConfigured,
      hostedUi: isGoogleSignInConfigured
        ? {
            domain: authConfig.domain,
            clientId: authConfig.clientId,
            redirectUri: authConfig.redirectUri,
            signOutUri: authConfig.signOutUri,
            scopes: ["openid", "email", "profile"],
          }
        : null,
    });
  });

  // Everything below needs the Cognito configuration:
  router.use((req, res, next) =>
    isAuthConfigured
      ? next()
      : res.status(503).json({
          code: "AUTH_NOT_CONFIGURED",
          message: "Sign-in is not configured on this server.",
        }),
  );

  router.use(requireJson);

  // Registration --------------------------------------------------------------

  router.post(
    "/sign-up",
    validateBody(signUpSchema),
    asyncRoute(async (req, res) => {
      const result = await signUp(req.body);
      res.status(201).json(result);
    }),
  );

  router.post(
    "/confirm-sign-up",
    validateBody(confirmSignUpSchema),
    asyncRoute(async (req, res) => {
      await confirmSignUp(req.body);
      res.json({ confirmed: true });
    }),
  );

  router.post(
    "/resend-code",
    validateBody(resendCodeSchema),
    asyncRoute(async (req, res) => {
      res.json(await resendConfirmationCode(req.body));
    }),
  );

  // Email/password sign-in ----------------------------------------------------

  router.post(
    "/sign-in",
    validateBody(signInSchema),
    asyncRoute(async (req, res) => {
      const tokens = await signInWithPassword(req.body);
      await respondWithSession(res, await toSession(tokens));
    }),
  );

  // Google sign-in (OAuth 2.0 authorization code + PKCE, run by the app) ------

  router.post(
    "/google/token",
    (req, res, next) =>
      isGoogleSignInConfigured
        ? next()
        : res.status(503).json({
            code: "GOOGLE_NOT_CONFIGURED",
            message: "Google sign-in is not configured on this server.",
          }),
    validateBody(googleTokenSchema),
    asyncRoute(async (req, res) => {
      const tokens = await exchangeAuthorizationCode(req.body);
      const session = await toSession(tokens);
      checkGooglePicture(session.user);
      await respondWithSession(res, session);
    }),
  );

  // Session -------------------------------------------------------------------

  // New ID and access tokens. `?fresh=1` passes `fresh` to enrichUser (e.g.
  // right after paying). A 401 means the app must sign in again.
  router.post(
    "/refresh",
    validateBody(refreshSchema),
    asyncRoute(async (req, res) => {
      let session;
      try {
        session = await refreshSession(req.body.refreshToken);
      } catch (error) {
        // Revoked or expired refresh token (other failures are server errors):
        if (error.code !== "INVALID_CREDENTIALS") {
          throw error;
        }
        return res.status(401).json({
          code: "SESSION_EXPIRED",
          message: "Your session has expired. Please sign in again.",
        });
      }
      return respondWithSession(res, session, {
        fresh: req.query.fresh === "1",
      });
    }),
  );

  // Password reset ------------------------------------------------------------

  router.post(
    "/forgot-password",
    validateBody(forgotPasswordSchema),
    asyncRoute(async (req, res) => {
      res.json(await forgotPassword(req.body));
    }),
  );

  router.post(
    "/reset-password",
    validateBody(resetPasswordSchema),
    asyncRoute(async (req, res) => {
      await confirmForgotPassword(req.body);
      res.json({ reset: true });
    }),
  );

  // Sign-out: revokes the refresh token (and the access tokens issued from it).
  // The app then deletes its stored tokens. Google users should also open
  // `logoutUrl` (e.g. WebBrowser.openAuthSessionAsync(logoutUrl, signOutUri))
  // to end the hosted-login session, so "Continue with Google" asks again.
  router.post(
    "/sign-out",
    validateBody(signOutSchema),
    asyncRoute(async (req, res) => {
      if (req.body.refreshToken) {
        try {
          await revokeRefreshToken(req.body.refreshToken);
        } catch {
          // Already revoked or expired: signed out anyway.
        }
      }

      res.json({
        signedOut: true,
        logoutUrl: isGoogleSignInConfigured ? getHostedSignOutUrl() : null,
      });
    }),
  );

  // Errors: safe messages only (details are logged in toAuthError).
  router.use((error, req, res, _next) => {
    const authError = toAuthError(error);
    res
      .status(authError.status)
      .json({ code: authError.code, message: authError.message });
  });

  return router;
};
