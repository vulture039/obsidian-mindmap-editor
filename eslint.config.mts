import obsidianmd from 'eslint-plugin-obsidianmd';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'node_modules',
    'dist',
    'esbuild.config.mjs',
    'version-bump.mjs',
    'versions.json',
    'main.js',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['manifest.json'],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
    plugins: {
      jsdoc,
    },
    rules: {
      'jsdoc/multiline-blocks': ['error', { noSingleLineBlocks: false }],
    },
  },
  ...obsidianmd.configs.recommended,
  eslintConfigPrettier,
  {
    // After eslint-config-prettier, which defensively turns curly off. It
    // doesn't actually conflict with Prettier (brace presence, not layout),
    // so re-enable it here to force braces on all control-flow bodies.
    rules: {
      curly: ['error', 'all'],
    },
  },
);
