/**
 * ASAP evidence service — pure request/response logic.
 *
 * Files are content-addressed: the R2 key is the SHA-256 of the bytes, so the
 * same photo always maps to the same URL and nobody can overwrite someone
 * else's evidence. Nothing in this file imports Cloudflare (or Node) APIs; the
 * worker passes in an `EvidenceStore` backed by R2, the dev server passes an
 * in-memory one, and tests pass their own.
 */

export const MAX_EVIDENCE_BYTES = 8_000_000;

/** Accepted upload types → file extension. */
export const CONTENT_TYPE_EXT: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `<64 hex>.<jpg|png|webp>` — anything else is a 400 before storage is touched. */
const EVIDENCE_KEY_RE = /^[a-f0-9]{64}\.(jpg|png|webp)$/;

const EXT_CONTENT_TYPE: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface StoredEvidence {
  /** R2 hands back a stream for large objects, an ArrayBuffer for small ones. */
  bytes: ArrayBuffer | ReadableStream;
  contentType: string;
}

/** The only thing the handler needs from storage. */
export interface EvidenceStore {
  put(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredEvidence | null>;
}

/** `image/jpeg; charset=binary` → `image/jpeg`. */
export function normalizeContentType(header: string | null): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

/** `image/jpeg` → `jpg`, or null when the type is not accepted. */
export function contentTypeToExt(contentType: string): 'jpg' | 'png' | 'webp' | null {
  return CONTENT_TYPE_EXT[contentType] ?? null;
}

/** Reverse mapping, used to serve a key when storage metadata is absent. */
export function extToContentType(ext: string): string {
  return EXT_CONTENT_TYPE[ext as 'jpg' | 'png' | 'webp'] ?? 'application/octet-stream';
}

export function isValidEvidenceKey(key: string): boolean {
  return EVIDENCE_KEY_RE.test(key);
}

/** Lowercase hex SHA-256 of the raw bytes (WebCrypto — Worker, Node and browser). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function evidencePublicUrl(key: string): string {
  return `/evidence/${key}`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

/**
 * `POST /api/evidence` — raw image body, no multipart.
 * 415 unsupported type · 400 empty body · 413 over 8 MB · 200 `{ url, sha256, bytes }`.
 */
export async function uploadEvidence(request: Request, store: EvidenceStore): Promise<Response> {
  const contentType = normalizeContentType(request.headers.get('content-type'));
  if (!contentTypeToExt(contentType)) {
    return json({ error: 'unsupported type — use jpeg, png or webp' }, 415);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: 'empty body' }, 400);
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) return json({ error: 'too large, max 8MB' }, 413);

  const sha256 = await sha256Hex(bytes);
  const key = `${sha256}.${contentTypeToExt(contentType)}`;
  await store.put(key, bytes, contentType);

  return json({ url: evidencePublicUrl(key), sha256, bytes: bytes.byteLength });
}

/**
 * `GET /evidence/<key>` — 400 on a malformed key, 404 when the object is gone,
 * otherwise the bytes with a year-long immutable cache and open CORS.
 */
export async function serveEvidence(key: string, store: EvidenceStore): Promise<Response> {
  if (!isValidEvidenceKey(key)) return new Response('bad key', { status: 400 });

  const object = await store.get(key);
  if (!object) return new Response('not found', { status: 404 });

  return new Response(object.bytes, {
    headers: {
      'content-type': object.contentType || extToContentType(key.split('.')[1] ?? ''),
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}

/** In-memory store: the dev server and the tests both use it. */
export function createMemoryEvidenceStore(): EvidenceStore {
  const objects = new Map<string, StoredEvidence>();
  return {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
  };
}
