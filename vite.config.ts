import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    sveltekit(),
    nodePolyfills({
      protocolImports: true,
      globals: {
        process: true,
        Buffer: true,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': process.env.NODE_ENV === 'test'
        ? 'http://localhost:3001'
        : 'http://localhost:3000'
    }
  }
});
