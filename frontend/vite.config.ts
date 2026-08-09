import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Prod CSP is `default-src 'self'` with no font-src/data: allowance —
    // inlined data: URIs (small font subsets, icons) get blocked at runtime.
    // Emit every asset as a file. Guarded by no-external-fonts.test.ts.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
