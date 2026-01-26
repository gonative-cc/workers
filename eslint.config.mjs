// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier";

const ignore = globalIgnores([
	"packages/**/*.d.ts",
	"packages/**/scripts/**",
	"packages/**/.mf/**",
	"packages/**/node_modules/**",
]);

export default tseslint.config(
	ignore,
	eslint.configs.recommended,
	tseslint.configs.strict,
	tseslint.configs.stylistic,
	{
		// disable specific rules
		rules: {
			"@typescript-eslint/no-extraneous-class": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
	{
		// Target all common test file patterns
		files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
		rules: {
			// Disable the non-null assertion rule only for these files
			"@typescript-eslint/no-non-null-assertion": "off",
		},
	},

	// Prettier configuration should be placed last to override any conflicting rules from earlier configurations.
	prettierConfig,
);
