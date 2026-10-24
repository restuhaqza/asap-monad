/**
 * ASAP evidence service.
 *
 * POST /api/evidence   multipart-free raw image body → stores in R2, returns a public URL
 * GET  /evidence/<key>  streams the stored image back
 * everything else       falls through to the static assets
 *
 * Files are content-addressed: the R2 key is the SHA-256 of the bytes, so the same photo
 * always maps to the same URL and nobody can overwrite someone else's evidence.
 */

const MAX_BYTES = 3_000_000;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/evidence') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return upload(request, env);
    }

    if (url.pathname.startsWith('/evidence/') && request.method === 'GET') {
      return serve(url.pathname.slice('/evidence/'.length), env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function upload(request, env) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  const ext = EXT[type];
  if (!ext) return json({ error: 'unsupported type — use jpeg, png or webp' }, 415);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: 'empty body' }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: 'too large, max 3MB' }, 413);

  const digest = await crypto.subtle.digest('SHA-256', body);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = `${sha256}.${ext}`;

  await env.EVIDENCE.put(key, body, {
    httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  return json({ url: `/evidence/${key}`, sha256, bytes: body.byteLength });
}

async function serve(key, env) {
  if (!/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(key)) return new Response('bad key', { status: 400 });
  const obj = await env.EVIDENCE.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}
