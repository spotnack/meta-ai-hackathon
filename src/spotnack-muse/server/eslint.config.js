import js from "@eslint/js";
import globals from "globals";
import pluginJest from "eslint-plugin-jest";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["node_modules"]),
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      // Express error handlers must declare all four arguments (`_next`):
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.js", "jest.setup.js"],
    plugins: { jest: pluginJest },
    languageOptions: {
      globals: globals.jest,
    },
    rules: {
      ...pluginJest.configs.recommended.rules,
    },
  },
]);
