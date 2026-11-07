// This file is used to enforce style consistency including JSDoc formatting.

const js = require("@eslint/js");
const pluginJSDoc = require("eslint-plugin-jsdoc");
const pluginJest = require("eslint-plugin-jest");

module.exports = [
  {
    // Global ignores (generated output, never linted).
    ignores: [".yarn/**", "client/.expo/**", "client/**/coverage/**"],
  },
  {
    files: ["client/**/*.{js,jsx,ts,tsx}"],
    ...js.configs.recommended,
    languageOptions: {
      // Runtime globals the Babel parser cannot see: no-undef needs them
      // declared (React Native / Expo provide them; tsc covers .ts/.tsx).
      globals: {
        AbortController: "readonly",
        __dirname: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        global: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
        setImmediate: "readonly",
        setTimeout: "readonly",
      },
      parser: require("@babel/eslint-parser"),
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["babel-preset-expo"],
        },
        ecmaFeatures: {
          jsx: true,
        },
        ecmaVersion: 2021,
        sourceType: "module",
      },
    },
    plugins: {
      jsdoc: pluginJSDoc,
      jest: pluginJest,
    },
    rules: {
      ...pluginJSDoc.configs.recommended.rules,
      ...pluginJest.configs.recommended.rules,
      indent: ["error", 2],
      "linebreak-style": ["error", "unix"],
      "no-undef": ["error"],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      // JSDoc-specific rules:
      "jsdoc/require-jsdoc": [
        "warn",
        {
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            ArrowFunctionExpression: false,
          },
        },
      ],
      "jsdoc/require-param": "warn",
      "jsdoc/require-returns": "warn",
      // Babel parser cannot resolve TypeScript types; TS itself validates them.
      "jsdoc/no-undefined-types": "off",
    },
  },
  {
    files: ["client/**/*.test.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...require("globals").jest,
        process: "readonly",
        require: "readonly",
        setImmediate: "readonly",
      },
    },
  },
  {
    // tsc already reports unknown names in TS; no-undef only false-positives there.
    files: ["client/**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
];
