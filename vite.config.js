import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/TheoLab/',
  plugins: [svelte()],
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,ts}'],
  },
});
