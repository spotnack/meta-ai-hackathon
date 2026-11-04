/*
Demo-auth configuration for the offline demo build (hackathon demo
at 10:00, no backend server).

EXPO_PUBLIC_AUTH_MODE=demo (set only in the preview EAS profile) enables
a "Continue as demo guest" path: a local session with no network calls,
so the board can reach the tabs without Express/Cognito. The normal
login UI is unchanged and still uses auth.api.ts when the flag is absent.
*/

export const AUTH_MODES = Object.freeze({
  DEFAULT: "default",
  DEMO: "demo",
});

export const isDemoAuthMode = () =>
  process.env.EXPO_PUBLIC_AUTH_MODE === AUTH_MODES.DEMO;

// Local-only demo session: no tokens, no server round-trip. The id scopes
// per-user storage (generated shapes, favourites) to the demo guest.
export const DEMO_GUEST_USER = Object.freeze({
  id: "demo-guest",
  name: "Demo guest",
  email: "demo@spotnack.local",
  provider: "demo",
});
