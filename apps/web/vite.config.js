import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isolateApi = process.env.SEQORA_E2E_API_ISOLATION === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    isolateApi && {
      name: 'e2e-api-isolation',
      configureServer(server) {
        server.middlewares.use('/api', (_request, response) => {
          response.statusCode = 503
          response.setHeader('Content-Type', 'application/json')
          response.end(
            JSON.stringify({
              error: {
                code: 'E2E_API_UNMOCKED',
                message: 'API requests must be handled by an E2E fixture.',
              },
            }),
          )
        })
      },
    },
  ],
  cacheDir: process.env.SEQORA_E2E_CACHE_DIR || undefined,
  server: {
    port: 5173,
    proxy: isolateApi
      ? undefined
      : {
          '/api': {
            target: 'http://127.0.0.1:8787',
            changeOrigin: true,
          },
        },
  },
})
