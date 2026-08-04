import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live next to the module they cover; the ones under test/
    // cross modules to hold the write path to "nothing else changes".
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Pure logic by default; the DOM-facing tests ask for jsdom themselves.
    environment: 'node',
  },
  resolve: {
    alias: {
      // The plugin's DOM code imports a few names from the app it runs in.
      obsidian: fileURLToPath(
        new URL('test/stubs/obsidian.ts', import.meta.url),
      ),
    },
  },
});
