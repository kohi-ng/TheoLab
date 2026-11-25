import { defineConfig } from 'vite';

export default defineConfig({
  base: '/TheoLab/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});
