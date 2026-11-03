// ESLint flat config (ESLint 10 + typescript-eslint 8).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [".webpack/**", "out/**", "coverage/**", "node_modules/**", "publish/**", "*.config.js", "webpack.*.js", "forge.config.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx,js}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Existing code base predates these rules; tighten them as files are rewritten.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "prefer-const": "warn",
    },
  },
  {
    files: ["src/preload/managers/*.worklet.js"],
    languageOptions: { globals: { ...globals.audioWorklet } },
  },
);
