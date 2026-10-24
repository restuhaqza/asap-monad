import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CONTENT_TYPE_EXT,
  contentTypeToExt,
  createMemoryEvidenceStore,
  evidencePublicUrl,
  extToContentType,
  isValidEvidenceKey,
  MAX_EVIDENCE_BYTES,
  normalizeContentType,
  serveEvidence,
  sha256Hex,
  uploadEvidence,
  type EvidenceStore,
  type StoredEvidence,
} from './evidence';

const API = 'http://localhost/api/evidence';

/** SHA-256 of the ASCII bytes `abc` — a published vector, independent of the impl. */
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function referenceSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function uploadRequest(body: Uint8Array<ArrayBufferLike> | undefined, contentType?: string): Request {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers['content-type'] = contentType;
  // `TextEncoder#encode` returns `Uint8Array<ArrayBufferLike>`; fetch accepts the bytes.
  return new Request(API, { method: 'POST', headers, body: body as BodyInit | undefined });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('normalizeContentType', () => {
  it('strips parameters and lowercases', () => {
    expect(normalizeContentType('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(normalizeContentType('IMAGE/PNG')).toBe('image/png');
    expect(normalizeContentType('  image/webp  ')).toBe('image/webp');
  });

  it('returns an empty string for a missing header', () => {
    expect(normalizeContentType(null)).toBe('');
  });
});

describe('contentTypeToExt / extToContentType', () => {
  it('maps the three accepted image types', () => {
    expect(contentTypeToExt('image/jpeg')).toBe('jpg');
    expect(contentTypeToExt('image/png')).toBe('png');
    expect(contentTypeToExt('image/webp')).toBe('webp');
  });

  it('rejects everything else', () => {
    expect(contentTypeToExt('image/gif')).toBeNull();
    expect(contentTypeToExt('text/plain')).toBeNull();
    expect(contentTypeToExt('')).toBeNull();
  });

  it('round-trips extension → content type', () => {
    for (const [type, ext] of Object.entries(CONTENT_TYPE_EXT)) {
      expect(extToContentType(ext)).toBe(type);
    }
  });

  it('falls back to octet-stream for an unknown extension', () => {
    expect(extToContentType('gif')).toBe('application/octet-stream');
    expect(extToContentType('')).toBe('application/octet-stream');
  });
});

describe('isValidEvidenceKey', () => {
  const good = `${'a'.repeat(64)}.png`;

  it('accepts lowercase hex digests with a jpg/png/webp extension', () => {
    expect(isValidEvidenceKey(good)).toBe(true);
    expect(isValidEvidenceKey(`${'0'.repeat(64)}.jpg`)).toBe(true);
    expect(isValidEvidenceKey(`${'f'.repeat(64)}.webp`)).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isValidEvidenceKey('../../etc/passwd')).toBe(false);
    expect(isValidEvidenceKey(`${'a'.repeat(64)}.png/../../etc/passwd`)).toBe(false);
  });

  it('rejects short digests and wrong lengths', () => {
    expect(isValidEvidenceKey('abc.jpg')).toBe(false);
    expect(isValidEvidenceKey(`${'a'.repeat(63)}.png`)).toBe(false);
    expect(isValidEvidenceKey(`${'a'.repeat(65)}.png`)).toBe(false);
    expect(isValidEvidenceKey('a'.repeat(64))).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(isValidEvidenceKey(`${'A'.repeat(64)}.png`)).toBe(false);
  });

  it('rejects extensions outside the allowlist', () => {
    expect(isValidEvidenceKey(`${'a'.repeat(64)}.gif`)).toBe(false);
    expect(isValidEvidenceKey(`${'a'.repeat(64)}.svg`)).toBe(false);
    expect(isValidEvidenceKey(`${'a'.repeat(64)}.png.js`)).toBe(false);
  });

  it('rejects query strings and fragments', () => {
    expect(isValidEvidenceKey(`${'a'.repeat(64)}.png?x=1`)).toBe(false);
    expect(isValidEvidenceKey(`${'a'.repeat(64)}.png#x`)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('matches the published SHA-256 vector for "abc"', async () => {
    const bytes = new TextEncoder().encode('abc');
    await expect(sha256Hex(bytes.buffer as ArrayBuffer)).resolves.toBe(ABC_SHA256);
  });

  it('matches node:crypto on binary input', async () => {
    const bytes = new Uint8Array(32).map((_, index) => index * 7);
    await expect(sha256Hex(bytes.buffer as ArrayBuffer)).resolves.toBe(referenceSha256(bytes));
  });

  it('is stable for the same bytes', async () => {
    const a = new TextEncoder().encode('same bytes').buffer as ArrayBuffer;
    const b = new TextEncoder().encode('same bytes').buffer as ArrayBuffer;
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
  });
});

describe('evidencePublicUrl', () => {
  it('builds the served path', () => {
    expect(evidencePublicUrl(`${'a'.repeat(64)}.jpg`)).toBe(`/evidence/${'a'.repeat(64)}.jpg`);
  });
});

describe('uploadEvidence', () => {
  it('stores a PNG and returns its content-addressed URL, digest and size', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new TextEncoder().encode('abc');
    const response = await uploadEvidence(uploadRequest(bytes, 'image/png'), store);
    const body = await bodyOf(response);

    const key = `${ABC_SHA256}.png`;
    expect(response.status).toBe(200);
    expect(body).toEqual({ url: `/evidence/${key}`, sha256: ABC_SHA256, bytes: 3 });

    const stored = await store.get(key);
    expect(stored).not.toBeNull();
    expect(stored?.contentType).toBe('image/png');
    expect(Array.from(new Uint8Array(stored!.bytes as ArrayBuffer))).toEqual(Array.from(bytes));
  });

  it('derives the digest from the bytes, not from headers', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new Uint8Array(64).map((_, index) => (index * 31) % 256);
    const response = await uploadEvidence(uploadRequest(bytes, 'image/jpeg'), store);
    const body = await bodyOf(response);

    expect(body.sha256).toBe(referenceSha256(bytes));
    expect(body.bytes).toBe(64);
    expect(response.status).toBe(200);
  });

  it('accepts jpeg and webp and keeps the extension in the key', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new TextEncoder().encode('abc');

    const jpeg = await bodyOf(await uploadEvidence(uploadRequest(bytes, 'image/jpeg'), store));
    const webp = await bodyOf(await uploadEvidence(uploadRequest(bytes, 'image/webp'), store));

    expect(jpeg.url).toBe(`/evidence/${ABC_SHA256}.jpg`);
    expect(webp.url).toBe(`/evidence/${ABC_SHA256}.webp`);
    // Same content, different declared type: the digest is identical either way.
    expect(jpeg.sha256).toBe(webp.sha256);
  });

  it('ignores a content-type parameter', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new TextEncoder().encode('abc');
    const response = await uploadEvidence(
      uploadRequest(bytes, 'image/png; charset=binary'),
      store,
    );

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({ url: `/evidence/${ABC_SHA256}.png` });
  });

  it('is content addressed: the same bytes uploaded twice give the same key', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new TextEncoder().encode('abc');

    const first = await bodyOf(await uploadEvidence(uploadRequest(bytes, 'image/png'), store));
    const second = await bodyOf(await uploadEvidence(uploadRequest(bytes, 'image/png'), store));

    expect(second.url).toBe(first.url);
    expect(second.sha256).toBe(first.sha256);
  });

  it('rejects a non-image content type with 415 before reading the body', async () => {
    const put = vi.fn(async () => undefined);
    const store: EvidenceStore = { put, get: async () => null };

    for (const contentType of ['text/plain', 'image/gif', 'application/octet-stream', '']) {
      const response = await uploadEvidence(
        uploadRequest(new TextEncoder().encode('abc'), contentType),
        store,
      );
      expect(response.status).toBe(415);
      await expect(bodyOf(response)).resolves.toEqual({
        error: 'unsupported type — use jpeg, png or webp',
      });
    }
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a missing content type with 415', async () => {
    const store = createMemoryEvidenceStore();
    const response = await uploadEvidence(uploadRequest(new TextEncoder().encode('abc')), store);

    expect(response.status).toBe(415);
  });

  it('rejects an empty body with 400 and stores nothing', async () => {
    const put = vi.fn(async () => undefined);
    const store: EvidenceStore = { put, get: async () => null };

    const response = await uploadEvidence(uploadRequest(new Uint8Array(0), 'image/png'), store);

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toEqual({ error: 'empty body' });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a body over the limit with 413 and stores nothing', async () => {
    const put = vi.fn(async () => undefined);
    const store: EvidenceStore = { put, get: async () => null };

    const response = await uploadEvidence(
      uploadRequest(new Uint8Array(MAX_EVIDENCE_BYTES + 1), 'image/png'),
      store,
    );

    expect(response.status).toBe(413);
    await expect(bodyOf(response)).resolves.toEqual({ error: 'too large, max 8MB' });
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts a body of exactly the limit', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new Uint8Array(MAX_EVIDENCE_BYTES);

    const response = await uploadEvidence(uploadRequest(bytes, 'image/png'), store);

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({ bytes: MAX_EVIDENCE_BYTES });
  });
});

describe('serveEvidence', () => {
  async function seededStore(): Promise<{ store: EvidenceStore; key: string }> {
    const store = createMemoryEvidenceStore();
    const bytes = new TextEncoder().encode('abc');
    const key = `${ABC_SHA256}.png`;
    await store.put(key, bytes.buffer as ArrayBuffer, 'image/png');
    return { store, key };
  }

  it('returns the bytes with an immutable year-long cache and open CORS', async () => {
    const { store, key } = await seededStore();

    const response = await serveEvidence(key, store);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
      Array.from(new TextEncoder().encode('abc')),
    );
  });

  it('falls back to the extension when stored metadata has no content type', async () => {
    const key = `${ABC_SHA256}.webp`;
    const object: StoredEvidence = {
      bytes: new TextEncoder().encode('abc').buffer as ArrayBuffer,
      contentType: '',
    };
    const store: EvidenceStore = { put: async () => undefined, get: async () => object };

    const response = await serveEvidence(key, store);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
  });

  it('returns 400 for a well-formed looking but invalid key without touching storage', async () => {
    const get = vi.fn(async () => null);
    const store: EvidenceStore = { put: async () => undefined, get };

    const response = await serveEvidence('../../../etc/passwd', store);

    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['path traversal', '../../etc/passwd'],
    ['nested traversal', `${'a'.repeat(64)}.png/../secret`],
    ['short digest', 'abc.jpg'],
    ['63 hex chars', `${'a'.repeat(63)}.png`],
    ['65 hex chars', `${'a'.repeat(65)}.png`],
    ['uppercase hex', `${'A'.repeat(64)}.png`],
    ['missing extension', 'a'.repeat(64)],
    ['gif extension', `${'a'.repeat(64)}.gif`],
    ['empty key', ''],
  ])('returns 400 for a malformed key (%s)', async (_label, key) => {
    const store = createMemoryEvidenceStore();
    const response = await serveEvidence(key, store);
    expect(response.status).toBe(400);
  });

  it('returns 404 for a well-formed key that is not stored', async () => {
    const store = createMemoryEvidenceStore();
    const response = await serveEvidence(`${'b'.repeat(64)}.png`, store);

    expect(response.status).toBe(404);
  });
});

describe('upload → serve round trip', () => {
  it('serves exactly what was uploaded, at the URL the upload returned', async () => {
    const store = createMemoryEvidenceStore();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    const uploaded = await bodyOf(await uploadEvidence(uploadRequest(bytes, 'image/png'), store));
    const key = String(uploaded.url).replace('/evidence/', '');
    const served = await serveEvidence(key, store);

    expect(served.status).toBe(200);
    expect(uploaded.sha256).toBe(referenceSha256(bytes));
    expect(Array.from(new Uint8Array(await served.arrayBuffer()))).toEqual(Array.from(bytes));
  });
});
