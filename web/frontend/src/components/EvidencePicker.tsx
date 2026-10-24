/**
 * Evidence capture for a claim.
 *
 * Two explicit buttons — "Choose file" and "Take photo" — each programmatically
 * click their own visually-hidden `<input type="file">`. The inputs are NOT
 * `display:none`: some mobile browsers refuse to open a picker for those, so
 * they stay in the layout at 1×1 px with opacity 0 (`.sr-input`).
 *
 * The claim button stays disabled until evidence actually exists (an uploaded
 * blob or a non-empty manual URL/CID). A previous build let a claim go through
 * with a placeholder string; that must never come back.
 */

import { useEffect, useRef, useState } from 'react';

import { compressImage } from '../lib/compress';
import { errorMessage } from '../lib/errors';
import { uploadEvidenceBlob } from '../lib/evidence-client';
import { formatKilobytes, formatMon, formatSha256Prefix } from '../lib/format';

interface EvidencePickerProps {
  bondWei: bigint;
  /** False until `requiredBond` has been read successfully for this bounty. */
  bondReady: boolean;
  /** True when no wallet is connected. */
  disabled: boolean;
  onClaim: (evidence: string) => void;
}

const HINT = 'Evidence must be captured within 25 km of the hotspot and after the satellite pass.';

export function EvidencePicker({ bondWei, bondReady, disabled, onClaim }: EvidencePickerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [evidence, setEvidence] = useState('');
  const [manual, setManual] = useState('');
  const [state, setState] = useState(HINT);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Object URLs are leaked easily; revoke whenever the preview changes.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;

    setBusy(true);
    setState('Compressing…');
    try {
      const blob = await compressImage(file);
      setPreviewUrl(URL.createObjectURL(blob));

      setState(`Uploading ${formatKilobytes(blob.size)}…`);
      const upload = await uploadEvidenceBlob(blob);

      setEvidence(upload.url);
      setState(`Stored · ${formatSha256Prefix(upload.sha256)}`);
    } catch (error) {
      setEvidence('');
      setState(`Upload failed: ${errorMessage(error)} — paste a URL instead.`);
    } finally {
      setBusy(false);
    }
  };

  const reference = evidence || manual.trim();
  // `bondReady` matters: sending a claim with an unknown bond reverts on-chain.
  const canClaim = Boolean(reference) && !disabled && !busy && bondReady;

  return (
    <div>
      <div className="ev-row">
        <button
          type="button"
          className="ev-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="ev-ico">＋</span> Choose file
        </button>
        <button
          type="button"
          className="ev-btn"
          onClick={() => cameraInputRef.current?.click()}
        >
          <span className="ev-ico">◉</span> Take photo
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void handleFile(file);
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void handleFile(file);
        }}
      />

      {previewUrl ? <img className="ev-preview" src={previewUrl} alt="evidence preview" /> : null}

      <div className="hint" id="f-state">
        {state}
      </div>

      <div className="field">
        <input
          value={manual}
          placeholder="or paste an IPFS CID / URL"
          onChange={(event) => setManual(event.target.value)}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canClaim}
          onClick={() => {
            if (reference) onClaim(reference);
          }}
        >
          Claim · bond {bondReady ? formatMon(bondWei) : '—'} MON
        </button>
      </div>

      <div className="hint">
        {bondReady
          ? 'Add evidence first — a photo or a URL. Bond ≥ pool is slashed if two verifiers reject.'
          : 'Reading the required bond from the contract…'}
      </div>
    </div>
  );
}
