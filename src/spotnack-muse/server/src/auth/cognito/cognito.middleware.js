/*
Protects API routes: requires a valid Cognito access token in the
`Authorization: Bearer <token>` header and exposes the user's id as
`req.auth.userId`.

Usage: router.get("/private", requireAuth, handler);
*/

import { verifyAccessToken } from "./verifyJwt.js";

const BEARER = /^Bearer\s+(\S+)$/i;

export const requireAuth = async (req, res, next) => {
  const accessToken = BEARER.exec(req.get("authorization") || "")?.[1];
  if (!accessToken) {
    return res
      .status(401)
      .json({ code: "UNAUTHENTICATED", message: "Please sign in." });
  }

  try {
    const claims = await verifyAccessToken(accessToken);
    req.auth = {
      userId: claims.sub,
      username: claims.username,
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
    };
    return next();
  } catch {
    // The app refreshes the tokens (POST /api/auth/refresh) and retries.
    return res.status(401).json({
      code: "SESSION_EXPIRED",
      message: "Your session has expired. Please sign in again.",
    });
  }
};
