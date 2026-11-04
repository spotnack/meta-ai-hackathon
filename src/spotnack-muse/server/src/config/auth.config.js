/*
Amazon Cognito configuration. These are identifiers and URLs, not secrets.
The app client is a public client (no client secret), and the Google client
secret is stored only in the Cognito user pool (AWS console), never here.

Values come from server/.env.
*/

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
dotenv.config({ path: path.join(serverDir, ".env") });

const trimTrailingSlash = (value = "") => {
  let result = value;
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
};

export const authConfig = {
  region: process.env.COGNITO_REGION || "",
  userPoolId: process.env.COGNITO_USER_POOL_ID || "",
  clientId: process.env.COGNITO_CLIENT_ID || "",
  // Cognito domain for the hosted sign-in (Google).
  // Example: https://<prefix>.auth.<region>.amazoncognito.com
  domain: trimTrailingSlash(process.env.COGNITO_DOMAIN),
  // Where the hosted login sends the user back to the mobile app (its URL scheme).
  // Both must be registered in the Cognito app client as allowed
  // callback and sign-out URLs.
  redirectUri: process.env.AUTH_REDIRECT_URI || "spotnackmuse://auth/callback",
  signOutUri: process.env.AUTH_SIGN_OUT_URI || "spotnackmuse://auth/sign-out",
};

export const isAuthConfigured = Boolean(
  authConfig.region && authConfig.userPoolId && authConfig.clientId,
);

export const isGoogleSignInConfigured =
  isAuthConfigured && authConfig.domain.startsWith("https://");
