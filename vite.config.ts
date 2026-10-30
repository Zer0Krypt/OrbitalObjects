import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves the embed script at /embed.js (from packages/embed, pointed at
 * wherever it's loaded from) and, when SITE_URL is known at build time,
 * an oEmbed endpoint with its discovery link.
 */
function embedFiles(): Plugin {
  const script = () =>
    fs
      .readFileSync('packages/embed/index.js', 'utf8')
      // The copy on the site points at the site it was loaded from.
      .replace(/export const DEFAULT_SRC = '[^']*';/, "export const DEFAULT_SRC = new URL('./', import.meta.url).href;");
  const site = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';
  return {
    name: 'orbital-objects-embed',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/embed.js')) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(script());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'embed.js', source: script() });
      if (!site) return;
      // A static host can't vary the response by ?url=, so this describes the live globe.
      const oembed = {
        version: '1.0',
        type: 'rich',
        provider_name: 'Orbital Objects',
        provider_url: site,
        title: 'Orbital Objects: everything in Earth orbit, live',
        width: 640,
        height: 400,
        thumbnail_url: `${site}icons/icon-512.png`,
        thumbnail_width: 512,
        thumbnail_height: 512,
        html: `<iframe src="${site}?embed" width="640" height="400" style="border:0;border-radius:12px;max-width:100%" loading="lazy" allow="fullscreen" title="Orbital Objects"></iframe>`,
      };
      this.emitFile({ type: 'asset', fileName: 'oembed.json', source: JSON.stringify(oembed, null, 2) });
    },
    transformIndexHtml(html) {
      if (!site) return html;
      return html.replace(
        '</head>',
        `    <link rel="alternate" type="application/json+oembed" href="${site}oembed.json" title="Orbital Objects" />\n    <meta property="og:url" content="${site}" />\n  </head>`,
      );
    },
  };
}

// Relative base so the build works at https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  plugins: [embedFiles()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // The app, and a small page about the data pipeline.
      input: { main: 'index.html', status: 'status.html' },
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
