/*
Input validation for the auth API (Joi). Rules mirror the Cognito user pool's
password policy (Cognito enforces it too).
*/

import Joi from "joi";

import { sanitizeText } from "../auth/user.js";

export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256; // Cognito's limit.

// Cognito's accepted special characters (plus inner spaces):
const SYMBOL = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+\- ]/;

const email = Joi.string()
  .trim()
  .lowercase()
  .max(254)
  .email({ tlds: { allow: false } })
  .required()
  .messages({
    "string.email": "Enter a valid email address.",
    "string.empty": "Enter your email address.",
    "any.required": "Enter your email address.",
  });

const newPassword = Joi.string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .pattern(/[a-z]/, "lowercase")
  .pattern(/[A-Z]/, "uppercase")
  .pattern(/\d/, "number")
  .pattern(SYMBOL, "symbol")
  .pattern(/^\S(.*\S)?$/, "no-edge-spaces")
  .required()
  .messages({
    "string.empty": "Enter a password.",
    "any.required": "Enter a password.",
    "string.min": `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    "string.max": "The password is too long.",
    "string.pattern.name":
      "Use upper and lowercase letters, a number and a symbol, without leading or trailing spaces.",
  });

// Sign-in only checks presence/length: the policy may have changed since the
// password was created, and Cognito does the real check.
const currentPassword = Joi.string()
  .max(PASSWORD_MAX_LENGTH)
  .required()
  .messages({
    "string.empty": "Enter your password.",
    "any.required": "Enter your password.",
  });

// Letters (any language), marks, spaces, apostrophes, hyphens and periods.
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

const name = Joi.string()
  .custom((value, helpers) => {
    const cleaned = sanitizeText(value, 61);
    if (!cleaned) {
      return helpers.error("string.empty");
    }
    if (cleaned.length > 60) {
      return helpers.error("string.max");
    }
    if (!NAME_PATTERN.test(cleaned)) {
      return helpers.error("string.pattern.base");
    }
    return cleaned;
  })
  .required()
  .messages({
    "string.empty": "Enter your name.",
    "any.required": "Enter your name.",
    "string.max": "Use at most 60 characters.",
    "string.pattern.base":
      "Use letters, spaces, apostrophes, hyphens or periods.",
  });

const confirmationCode = Joi.string()
  .trim()
  .pattern(/^\d{6}$/)
  .required()
  .messages({
    "string.pattern.base": "Enter the 6-digit code from the email.",
    "string.empty": "Enter the 6-digit code from the email.",
    "any.required": "Enter the 6-digit code from the email.",
  });

// Cognito refresh tokens are opaque (an encrypted JWT, about 1.8 KB):
const refreshToken = Joi.string().max(8192).messages({
  "string.empty": "The refresh token is missing.",
  "any.required": "The refresh token is missing.",
});

export const signUpSchema = Joi.object({
  name,
  email,
  password: newPassword,
  acceptTerms: Joi.boolean().valid(true).required().messages({
    "any.only": "Accept the Terms of Service and Privacy Policy.",
    "any.required": "Accept the Terms of Service and Privacy Policy.",
  }),
});

export const confirmSignUpSchema = Joi.object({ email, code: confirmationCode });

export const resendCodeSchema = Joi.object({ email });

export const signInSchema = Joi.object({
  email,
  password: currentPassword,
});

export const refreshSchema = Joi.object({
  refreshToken: refreshToken.required(),
});

// Signing out without a refresh token still succeeds (nothing to revoke).
export const signOutSchema = Joi.object({ refreshToken });

export const forgotPasswordSchema = Joi.object({ email });

export const resetPasswordSchema = Joi.object({
  email,
  code: confirmationCode,
  password: newPassword,
});

// Google sign-in: the authorization code and PKCE verifier (RFC 7636) the app
// got from the Cognito hosted login, and the redirect URI it used there.
export const googleTokenSchema = Joi.object({
  code: Joi.string().pattern(/^[\w-]{1,512}$/).required(),
  codeVerifier: Joi.string()
    .pattern(/^[\w.~-]{43,128}$/)
    .required(),
  // The app's URL scheme (or exp:// in Expo Go). Cognito also requires it to be
  // a registered callback URL.
  redirectUri: Joi.string()
    .uri()
    .max(2048)
    .pattern(/^(?!(?:javascript|data|vbscript|file):)/i),
});
