/*
Jest configuration for the client (Expo) workspace. Referenced by the root jest.config.cjs.
moduleNameMapper mirrors the path aliases in tsconfig.json, which Metro resolves but Jest does not.
*/
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.{js,jsx,ts,tsx}"],
  moduleNameMapper: {
    "^@/assets/(.*)$": "<rootDir>/assets/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@app/(.*)$": "<rootDir>/src/app/$1",
    "^@features/(.*)$": "<rootDir>/src/features/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1",
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@hooks/(.*)$": "<rootDir>/src/hooks/$1",
  },
};
