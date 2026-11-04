// Hermes (React Native) provides `process` but not `process.emitWarning`.
// three.cjs v0.155+ calls it unconditionally as a CJS deprecation notice,
// which crashes the app. This polyfill runs before any module code.
(function () {
  if (typeof process !== "undefined" && typeof process.emitWarning !== "function") {
    process.emitWarning = function () {};
  }


})();
