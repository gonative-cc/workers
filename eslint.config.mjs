// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

const ignore = globalIgnores(['packages/**/*.d.ts']);

export default tseslint.config(ignore, eslint.configs.recommended, tseslint.configs.strict, tseslint.configs.stylistic);
