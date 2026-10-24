import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { allowedHosts: ['terminal.local'] },
  build: { target: 'es2022', rollupOptions: { input: { main: 'index.html', qa: 'qa/index.html' } } },
  worker: { format: 'es' },
});
