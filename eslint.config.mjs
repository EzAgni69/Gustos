// One ESLint config for the whole monorepo. ESLint 9 looks upward from the
// directory it is run in, so every workspace's `eslint src/` picks this up.
import baseConfig from "./tooling/eslint-config/index.js";

export default [
  ...baseConfig,
  {
    ignores: [
      "**/dist/**",
      "**/dist-packages/**",
      "**/.next/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/android/**",
      "**/ios/**",
      "**/drizzle/**",
      "**/next-env.d.ts",
      "**/*.config.{js,mjs,cjs,ts}",
    ],
  },
  {
    // React Native bundles images, fonts and sounds through require()
    files: ["apps/app-captain/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Seed / maintenance scripts and tests may log and use loose types freely
    files: ["**/scripts/**", "**/__tests__/**", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
