import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_BACKEND_URL || 'http://localhost:5000';
  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 5173,
      // The browser only ever talks to the Vite origin, so cookies, file downloads
      // and WebSockets all stay same-origin in development.
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/socket.io': { target: backend, ws: true, changeOrigin: true },
      },
    },
  };
});
