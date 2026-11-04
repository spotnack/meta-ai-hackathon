/*
Preloads the user pool's JSON Web Key Set (public signing keys) at startup, so
the first request does not wait for it. The verifiers cache the keys and
refetch them when Cognito rotates its keys.
*/

import { getVerifiers } from "./verifyJwt.js";

export const preloadJwks = async () => {
  const { id, access } = getVerifiers();
  try {
    await Promise.all([id.hydrate(), access.hydrate()]);
  } catch (error) {
    // Not fatal: keys are fetched again on the first verification.
    console.warn("[auth] Could not preload the Cognito JWKS:", error.message);
  }
};
