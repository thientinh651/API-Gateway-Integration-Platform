import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const gateway = env.VITE_GATEWAY_ORIGIN || 'http://127.0.0.1:3000';

  /** Dev + preview: không proxy → fetch /api/* trả 404 từ Vite. */
  const gatewayProxy = {
    '/api': { target: gateway, changeOrigin: true },
    '/health': { target: gateway, changeOrigin: true },
    '/metrics': { target: gateway, changeOrigin: true },
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3001,
      proxy: gatewayProxy,
    },
    preview: {
      proxy: gatewayProxy,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          login: path.resolve(__dirname, 'login.html'),
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
