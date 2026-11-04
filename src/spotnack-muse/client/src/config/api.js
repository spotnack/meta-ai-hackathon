import Constants from "expo-constants";

/*
Resolves the Express API's base URL for the current run.

React Native can't reach the host machine via `localhost` the way a browser
tab can: on a physical device or emulator, `localhost` means the device
itself, not the computer running `expo start`/the API server. Resolution
order:

  1. EXPO_PUBLIC_API_BASE_URL - full override (e.g. a staging/prod API, or a
     tunnel URL), for when nothing below is right.
  2. EXPO_PUBLIC_API_HOST (+ EXPO_PUBLIC_API_PORT) - explicit host override,
     for setups where auto-detection (below) picks the wrong interface.
  3. Auto-derived from Constants.expoConfig.hostUri, which the Expo dev
     server populates with "<lan-ip>:<metro-port>" - correct for the common
     case of a physical device or emulator on the same LAN as the dev
     machine, running via `expo start`.
  4. "localhost" - last-resort fallback. Only reachable from `expo start
     --web` or the iOS simulator (which shares the host's network
     namespace); an Android emulator or physical device needs (2) or (3).

EXPO_PUBLIC_* variables are inlined by Expo's Metro config automatically -
see client/.env.example for how to set them.
*/

const DEFAULT_PORT = "5000";

const deriveLanHost = () => {
  const hostUri =
    Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.hostUri;
  return hostUri ? hostUri.split(":")[0] : null;
};

export const getApiBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }

  const host =
    process.env.EXPO_PUBLIC_API_HOST || deriveLanHost() || "localhost";
  const port = process.env.EXPO_PUBLIC_API_PORT || DEFAULT_PORT;

  return `http://${host}:${port}/api`;
};
