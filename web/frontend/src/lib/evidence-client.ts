/** Browser side of the evidence API — POST the JPEG, get an absolute URL back. */

export interface EvidenceUpload {
  /** Absolute URL, safe to store on-chain as the evidence reference. */
  url: string;
  sha256: string;
  bytes: number;
}

interface UploadResponse {
  url?: string;
  sha256?: string;
  bytes?: number;
  error?: string;
}

export async function uploadEvidenceBlob(blob: Blob): Promise<EvidenceUpload> {
  const response = await fetch('/api/evidence', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  });

  const body = (await response.json().catch(() => ({}))) as UploadResponse;
  if (!response.ok) {
    throw new Error(body.error ?? `upload failed (${response.status})`);
  }
  if (!body.url || !body.sha256) throw new Error('upload failed — malformed response');

  return {
    url: new URL(body.url, window.location.origin).href,
    sha256: body.sha256,
    bytes: body.bytes ?? blob.size,
  };
}
