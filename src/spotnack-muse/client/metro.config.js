const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");


const config = getDefaultConfig(__dirname);

// Allow Metro to bundle .glb files as static assets (require() in JS).
config.resolver.assetExts.push("glb");

// Locate three's package root — hoisted to the workspace root in this monorepo.
const threeRoot = (() => {
  const local = path.resolve(__dirname, "node_modules/three");
  const workspace = path.resolve(__dirname, "../node_modules/three");
  return fs.existsSync(local) ? local : workspace;
})();

// two issues with three.js v0.155+ and Expo SDK 58 (package-exports enabled by default):
//  1. require('three') resolves to src/Three.js (ESM-only) → redirect to three.cjs
//  2. @react-spring/three accesses 'three/package.json' but three's exports field
//     doesn't expose that subpath → Metro throws; intercept it explicitly.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") {
    return {
      filePath: path.join(threeRoot, "build", "three.cjs"),
      type: "sourceFile",
    };
  }
  if (moduleName === "three/package.json") {
    return {
      filePath: path.join(threeRoot, "package.json"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Inject a polyfill before any module code so process.emitWarning exists when
// three.cjs loads (Hermes provides `process` but not `process.emitWarning`).
const existingGetPolyfills = config.serializer?.getPolyfills;
config.serializer = {
  ...(config.serializer ?? {}),
  getPolyfills: (options) => [
    path.resolve(__dirname, "polyfills/process-emit-warning.js"),
    ...(existingGetPolyfills?.(options) ?? []),
  ],
};

module.exports = config;
