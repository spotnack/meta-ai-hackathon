/*
Builds the user object returned to the app from verified ID token claims.
Claims such as `name` and `picture` come from the user or from Google (an
external identity provider), so they are treated as untrusted and sanitized.
*/

// Control (\p{Cc}: U+0000-U+001F, U+007F-U+009F), zero-width and
// bidirectional-override characters:
const UNSAFE_CHARACTERS =
  /[\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;

export const sanitizeText = (value, maxLength) =>
  typeof value === "string"
    ? value
      .normalize("NFC")
      .replace(UNSAFE_CHARACTERS, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength)
    : "";

// Only absolute https URLs (no javascript:, data:, http:, ...):
export const sanitizeHttpsUrl = (value) => {
  if (typeof value !== "string" || value.length > 2048) {
    return "";
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};

const getIdentityProvider = (claims) => {
  let identities = claims.identities;
  if (typeof identities === "string") {
    try {
      identities = JSON.parse(identities);
    } catch {
      identities = [];
    }
  }
  const providerName = Array.isArray(identities)
    ? identities[0]?.providerName
    : undefined;
  return providerName === "Google" ? "google" : "cognito";
};

// Subscription plan from the user pool's optional `custom:plan` attribute.
// Unknown or missing values fall back to the free plan.
export const PLANS = ["basic", "pro"];
const getPlan = (claims) => {
  const plan = String(claims["custom:plan"] || "").toLowerCase();
  return PLANS.includes(plan) ? plan : "basic";
};

export const toPublicUser = (claims) => {
  const email = sanitizeText(claims.email, 254);
  return {
    id: claims.sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: sanitizeText(claims.name, 60) || email.split("@")[0],
    picture: sanitizeHttpsUrl(claims.picture),
    provider: getIdentityProvider(claims),
    plan: getPlan(claims),
  };
};
