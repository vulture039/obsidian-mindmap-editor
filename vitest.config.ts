import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live next to the modules they cover (src/*.test.ts).
    include: ['src/**/*.test.ts'],
    // Pure logic only, no DOM needed.
    environment: 'node',
  },
});
