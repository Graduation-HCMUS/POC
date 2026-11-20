import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_PROXY_TARGET')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target:
            process.env.API_PROXY_TARGET ||
            env.API_PROXY_TARGET ||
            'http://127.0.0.1:3000',
        },
      },
    },
  }
})
