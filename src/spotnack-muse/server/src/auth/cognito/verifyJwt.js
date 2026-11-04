/*
Verifies Cognito JWTs: signature (against the user pool's JWKS), issuer,
audience/client id, token use and expiration. Never trust a decoded but
unverified token.
*/

import { CognitoJwtVerifier } from "aws-jwt-verify";

import { authConfig } from "../../config/auth.config.js";

let verifiers;

export const getVerifiers = () => {
  if (!verifiers) {
    const options = {
      userPoolId: authConfig.userPoolId,
      clientId: authConfig.clientId,
    };
    verifiers = {
      id: CognitoJwtVerifier.create({ ...options, tokenUse: "id" }),
      access: CognitoJwtVerifier.create({ ...options, tokenUse: "access" }),
    };
  }
  return verifiers;
};

// Each resolves to the token's claims, or rejects if the token is not valid.
export const verifyIdToken = (token) => getVerifiers().id.verify(token);
export const verifyAccessToken = (token) => getVerifiers().access.verify(token);
