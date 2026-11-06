/*
Non-fatal guard for expo-gl context creation failures.

Root cause of the Explore-during-conversion kill: expo-gl's GLView throws
`CodedError(ERR_GL_NOT_AVAILABLE, "GL is currently not available. ...")`
from its `_onSurfaceCreate` *event handler* (expo-gl/build/GLView.js:
`getGl` throws when the native side could not create the context, e.g.
under DMA-BUF/memory pressure or with several viewers mounting at once).
React error boundaries cannot catch event-handler throws, so in release
builds the exception is fatal and takes the whole process — including a
conversion running in the foreground service — down with it.

Neither the app nor @react-three/fiber can intercept that throw at the
source: R3F's native Canvas renders GLView internally and passes only
`onContextCreate`, which never runs when the context is missing. The only
interception point short of forking node_modules (patch-package) is the
global JS error handler, so this module installs a narrow filter there:

- errors matching `isGlNotAvailableError` (exact expo-gl code, with the
  exact message as backup) are reported as warnings and swallowed; every
  mounted viewer is notified so it can show its static fallback instead.
- everything else is re-thrown to the previously installed handler, so
  dev LogBox and release fatal behavior are unchanged for real bugs.

Kept in this leaf module (no imports) so jest can cover the predicate and
the delegation without loading react-native.
*/

export const GL_NOT_AVAILABLE_CODE = "ERR_GL_NOT_AVAILABLE";
export const GL_NOT_AVAILABLE_MESSAGE = "GL is currently not available";

/**
 * Whether an error is expo-gl's "context could not be created" failure.
 * @param {unknown} error - Whatever reached the global handler.
 * @returns {boolean} True only for the expo-gl GL-unavailable failure.
 */
export function isGlNotAvailableError(error) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return false;
  }
  if (error.code === GL_NOT_AVAILABLE_CODE) return true;
  const message =
    typeof error.message === "string" ? error.message : String(error);
  return message.includes(GL_NOT_AVAILABLE_MESSAGE);
}

const listeners = new Set();

/**
 * Notifies every subscriber, never letting one bad listener break the rest.
 * @param {Error} error - The swallowed GL-unavailable error.
 */
function notifyGlNotAvailable(error) {
  listeners.forEach((listener) => {
    try {
      listener(error);
    } catch (err) {
      console.warn(`- A 3D fallback listener failed: ${err?.message}`);
    }
  });
}

/**
 * Builds the guarded global handler. Pure (no globals) so tests can cover
 * the matching and delegation directly.
 * @param {function(Error, boolean): void|null} previousHandler - Handler to delegate non-matching errors to.
 * @param {function(Error): void} onNotAvailable - Called with each swallowed GL-unavailable error.
 * @returns {function(Error, boolean): void} A global-handler-shaped function.
 */
export function buildGuardedHandler(previousHandler, onNotAvailable) {
  return (error, isFatal) => {
    if (isGlNotAvailableError(error)) {
      console.warn(`- 3D view unavailable (non-fatal): ${error?.message}`);
      onNotAvailable(error);
      return;
    }
    if (typeof previousHandler === "function") {
      previousHandler(error, isFatal);
    }
  };
}

const installedHosts = new Set();

/**
 * Installs the guard on a global-handler host (defaults to RN's ErrorUtils).
 * Idempotent per host; test hosts stay isolated from the real one.
 * @param {object} [host] - `{ getGlobalHandler, setGlobalHandler }`.
 */
export function ensureGlGuardInstalled(host) {
  const handlerHost = host ?? global.ErrorUtils;
  if (!handlerHost || installedHosts.has(handlerHost)) return;
  const previous =
    typeof handlerHost.getGlobalHandler === "function"
      ? handlerHost.getGlobalHandler()
      : null;
  handlerHost.setGlobalHandler(
    buildGuardedHandler(previous, notifyGlNotAvailable),
  );
  installedHosts.add(handlerHost);
}

/**
 * Subscribes a mounted viewer to GL-unavailable notifications (and installs
 * the guard on first use). The viewer should switch to its static fallback.
 * @param {function(Error): void} listener - Called with the swallowed error.
 * @returns {function(): void} Unsubscribe function.
 */
export function subscribeGlNotAvailable(listener) {
  ensureGlGuardInstalled();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
