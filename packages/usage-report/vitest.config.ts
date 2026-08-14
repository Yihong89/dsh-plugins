import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // globals enables @testing-library/react's automatic cleanup between tests.
    globals: true,
    include: ['tests/**/*.test.tsx'],
  },
})
