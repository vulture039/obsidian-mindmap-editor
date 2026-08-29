import obsidianmd from 'eslint-plugin-obsidianmd';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'node_modules',
    'dist',
    // The dev vault holds fixtures and a third-party plugin, neither ours.
    'dev-vault',
    'esbuild.config.mjs',
    'version-bump.mjs',
    // Hand-run harness: a Node driver and a snippet the renderer evaluates,
    // which is a function body rather than a module.
    'test/e2e',
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
  {
    // Tests and build config are not the plugin: they may reach for Node and
    // build DOM the plain way, and no user ever sees their strings.
    files: ['test/**/*.ts', 'vitest.config.ts'],
    rules: {
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/no-global-this': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/ui/sentence-case': 'off',
      // The stub is what defines instanceOf; it cannot use it.
      'obsidianmd/prefer-instanceof': 'off',
    },
  },
  eslintConfigPrettier,
  {
    // These sit after eslint-config-prettier on purpose. Prettier manages
    // layout but never *adds* blank lines or braces, so neither conflicts;
    // the prettier config defensively turns curly off, so re-enable it here.
    plugins: { '@stylistic': stylistic },
    rules: {
      curly: ['error', 'all'],
      'no-nested-ternary': 'error',
      // Light breathing room: a blank line before returns and after a group
      // of variable declarations. Blocks (if/for/…) aren't padded, so guard
      // clauses stay compact.
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        {
          blankLine: 'any',
          prev: ['const', 'let', 'var'],
          next: ['const', 'let', 'var'],
        },
      ],
    },
  },
);
