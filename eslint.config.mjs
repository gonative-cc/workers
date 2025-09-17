// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier";

const ignore = globalIgnores(["packages/**/*.d.ts"]);

export default tseslint.config(
  ignore,
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    // disable specific rules
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Prettier configuration should be placed last to override any conflicting rules from earlier configurations.
  prettierConfig
);
