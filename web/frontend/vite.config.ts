/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  createMemoryEvidenceStore,
  serveEvidence,
  uploadEvidence,
  type EvidenceStore,
} from './src/lib/evidence';

/** Pipe a Web `Response` back through Node's `http.ServerResponse`. */
async function sendNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * `vite dev` has no Cloudflare worker, so `/api/evidence` and `/evidence/<key>`
 * get the same pure handlers backed by an in-memory store. That keeps the photo
 * upload demoable on `npm run dev`; the real R2 binding is exercised by
 * `npm run cf:dev`.
 */
function evidenceDevServer(): Plugin {
  const store: EvidenceStore = createMemoryEvidenceStore();

  return {
    name: 'asap-evidence-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

        if (pathname === '/api/evidence') {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('method not allowed');
            return;
          }
          void (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const request = new Request('http://localhost/api/evidence', {
              method: 'POST',
              headers: { 'content-type': String(req.headers['content-type'] ?? '') },
              body: Buffer.concat(chunks),
            });
            await sendNodeResponse(res, await uploadEvidence(request, store));
          })();
          return;
        }

        if (pathname.startsWith('/evidence/')) {
          const key = decodeURIComponent(pathname.slice('/evidence/'.length));
          void (async () => {
            await sendNodeResponse(res, await serveEvidence(key, store));
          })();
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), evidenceDevServer()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      // Three entry points: the landing at /, the app at /portal, and the
      // whitepaper at /whitepaper (generated from docs/WHITEPAPER.md).
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        portal: fileURLToPath(new URL('./portal.html', import.meta.url)),
        whitepaper: fileURLToPath(new URL('./whitepaper.html', import.meta.url)),
      },
      output: {
        // viem and leaflet are the two big, long-lived dependencies
        manualChunks: {
          leaflet: ['leaflet'],
          viem: ['viem'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
