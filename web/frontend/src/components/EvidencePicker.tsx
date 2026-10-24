/**
 * Evidence capture for a claim.
 *
 * Each control is a `<label>` with its own `<input type="file">` stretched over
 * it at zero opacity. The click therefore lands on the native input itself,
 * no `input.click()` call anywhere. That matters: Safari and several WebViews
 * ignore a programmatic click on a visually hidden input, which is exactly how
 * "Choose file does nothing" happened in the field.
 *
 * The claim button stays disabled until evidence actually exists (an uploaded
 * blob or a non-empty manual URL/CID) and the required bond is known. A
 * previous build let a claim through with a placeholder string; that must never
 * come back.
 */

import { useEffect, useRef, useState } from 'react';

import { canAfford } from '../lib/balance';
import { compressImage } from '../lib/compress';
import { errorMessage } from '../lib/errors';
import { MAX_UPLOAD_BYTES, uploadEvidenceBlob } from '../lib/evidence-client';
import { formatKilobytes, formatMon, formatSha256Prefix } from '../lib/format';

interface EvidencePickerProps {
  bondWei: bigint;
  /** False until `requiredBond` has been read successfully for this bounty. */
  bondReady: boolean;
  /** Wallet balance in wei; null while unknown. */
  balanceWei?: bigint | null;
  /** True when no wallet is connected. */
  disabled: boolean;
  onClaim: (evidence: string) => void;
}

const HINT = 'Evidence must be captured within 25 km of the hotspot and after the satellite pass.';

/** Formats a photo compress can read but did not have to re-encode. */
const READABLE_TYPES = /^image\/(jpeg|jpg|png|webp)$/i;

export function EvidencePicker({
  bondWei,
  bondReady,
  balanceWei = null,
  disabled,
  onClaim,
}: EvidencePickerProps) {
  const [evidence, setEvidence] = useState('');
  const [manual, setManual] = useState('');
  const [state, setState] = useState(HINT);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dialogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Object URLs are leaked easily; revoke whenever the preview changes.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (dialogTimer.current) clearTimeout(dialogTimer.current);
    if (!file) return;

    setBusy(true);
    setState('Compressing…');
    try {
      let blob: Blob;
      try {
        blob = await compressImage(file);
      } catch {
        // Phones hand us formats a canvas cannot always decode (HEIC on Android)
        // and very large images can exhaust the canvas. If the browser already
        // gave us a supported type, send the original instead of blocking the
        // claim; if it did not, say what to do about it.
        if (!READABLE_TYPES.test(file.type)) {
          throw new Error(
            `${file.type || 'this format'} cannot be read by this browser. Use Take photo instead.`,
          );
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(`the original is ${formatKilobytes(file.size)}, over the ${formatKilobytes(MAX_UPLOAD_BYTES)} limit`);
        }
        blob = file;
        setState(`Sending the original (${formatKilobytes(file.size)})…`);
      }

      setPreviewUrl(URL.createObjectURL(blob));
      setState(`Uploading ${formatKilobytes(blob.size)}…`);
      const upload = await uploadEvidenceBlob(blob);

      setEvidence(upload.url);
      setState(`Stored · ${formatSha256Prefix(upload.sha256)}`);
    } catch (error) {
      setEvidence('');
      setState(`Upload failed: ${errorMessage(error)}. Paste a URL instead.`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Escape hatch for environments that swallow the file dialog: a screenshot
   * pasted with ⌘V, or an image dropped on the panel, goes through exactly the
   * same compress + upload path.
   */
  const handleFileRef = useRef(handleFile);
  useEffect(() => {
    handleFileRef.current = handleFile;
  });

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const file = Array.from(event.clipboardData?.files ?? []).find((candidate) =>
        candidate.type.startsWith('image/'),
      );
      if (!file) return;
      event.preventDefault();
      void handleFileRef.current(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const onPick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Reset first: picking the same file twice must fire `change` again.
    event.target.value = '';
    void handleFile(file);
  };

  /**
   * A few environments swallow the file dialog: a policy, an extension, or a
   * WebView without file support. Nothing observable happens, which is exactly
   * how this felt like a dead button. If neither a change nor a window blur
   * arrives shortly after the click, say so instead of staying mute.
   */
  const watchForDialog = (): void => {
    if (dialogTimer.current) clearTimeout(dialogTimer.current);
    let opened = false;
    const markOpened = () => {
      opened = true;
      window.removeEventListener('blur', markOpened);
    };
    window.addEventListener('blur', markOpened, { once: true });
    dialogTimer.current = setTimeout(() => {
      window.removeEventListener('blur', markOpened);
      if (!opened) {
        setState(
          'No file dialog opened. Your browser or an extension may be blocking it. Try a new tab, or turn extensions off for this site.',
        );
      }
    }, 2500);
  };

  const reference = evidence || manual.trim();
  // `bondReady` matters: sending a claim with an unknown bond reverts on-chain.
  // So does a bond the wallet cannot cover.
  const affordable = canAfford(balanceWei, bondWei);
  const canClaim = Boolean(reference) && !disabled && !busy && bondReady && affordable;

  return (
    <div
      className={dragging ? 'ev-root ev-dragging' : 'ev-root'}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFile(event.dataTransfer.files?.[0]);
      }}
    >
      <div className="ev-row">
        <label className="ev-btn" onClick={watchForDialog}>
          <span className="ev-ico">＋</span> Choose file
          <input type="file" accept="image/*" className="ev-input" onChange={onPick} />
        </label>

        <label className="ev-btn" onClick={watchForDialog}>
          <span className="ev-ico">◉</span> Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="ev-input"
            onChange={onPick}
          />
        </label>
      </div>

      <div className="ev-alt">
        or press ⌘V to paste a screenshot
      </div>

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
        {!bondReady
          ? 'Reading the required bond from the contract…'
          : !affordable
            ? `You need ${formatMon(bondWei)} MON for the bond and do not have it.`
            : 'Add evidence first, a photo or a URL. A bond at or above the pool is slashed if two verifiers reject.'}
      </div>
    </div>
  );
}
