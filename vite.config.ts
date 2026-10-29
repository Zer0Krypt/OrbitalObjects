import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Libraries change far less often than the app: a separate chunk stays
        // cached across deploys.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/satellite.js')) return 'satellite';
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
