import { defineConfig } from 'vitest/config';

// Configuration des tests unitaires (Vitest)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
