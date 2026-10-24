/**
 * ASAP evidence worker.
 *
 * POST /api/evidence    → raw image body → R2, returns a content-addressed URL
 * GET  /evidence/<key>  → streams the stored image back (HEAD supported)
 * everything else       → the built SPA in ./dist via the ASSETS binding
 */

import type { EvidenceStore } from './src/lib/evidence';
import { serveEvidence, uploadEvidence } from './src/lib/evidence';

interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}

interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

interface Env {
  EVIDENCE: R2BucketLike;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** R2-backed store — the only Cloudflare-specific piece, kept here on purpose. */
function r2Store(bucket: R2BucketLike): EvidenceStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        bytes: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType ?? '',
      };
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/evidence' || url.pathname.startsWith('/evidence/')) {
      // A missing binding is a deploy misconfiguration, not a client error.
      if (!env.EVIDENCE) {
        return new Response(JSON.stringify({ error: 'evidence storage not configured' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const store = r2Store(env.EVIDENCE);

    if (url.pathname === '/api/evidence') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method not allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }
      return uploadEvidence(request, store);
    }

    if (url.pathname.startsWith('/evidence/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const key = decodeURIComponent(url.pathname.slice('/evidence/'.length));
      const response = await serveEvidence(key, store);
      if (request.method === 'HEAD') {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }

    // Clean URLs: the app lives at /portal, the landing at /.
    if (url.pathname === '/portal' || url.pathname === '/portal/') {
      const rewritten = new URL(request.url);
      rewritten.pathname = '/portal.html';
      return env.ASSETS.fetch(new Request(rewritten.toString(), { method: 'GET', headers: request.headers }));
    }

    // The landing used to live at /start; keep old links working.
    if (url.pathname === '/start' || url.pathname === '/start/') {
      return Response.redirect(new URL('/', request.url).toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
