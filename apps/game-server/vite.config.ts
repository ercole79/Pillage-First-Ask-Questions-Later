import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // vite-node loads packages that use `?raw` SQL imports.
    fs: {
      allow: ['../..'],
    },
  },
});
