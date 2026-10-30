import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The web app and the API share one address (docs/adr/0001), so during
    // development the dev server passes /api on to the API.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // The browser tests in e2e/ run with Playwright instead.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
