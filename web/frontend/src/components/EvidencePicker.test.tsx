import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { compressImageMock, uploadEvidenceBlobMock } = vi.hoisted(() => ({
  compressImageMock: vi.fn(),
  uploadEvidenceBlobMock: vi.fn(),
}));

vi.mock('../lib/compress', () => ({ compressImage: compressImageMock }));
vi.mock('../lib/evidence-client', () => ({
  uploadEvidenceBlob: uploadEvidenceBlobMock,
  MAX_UPLOAD_BYTES: 8_000_000,
}));

import { EvidencePicker } from './EvidencePicker';

const BOND = 50_000_000_000_000_000n; // 0.05 MON
const SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const UPLOAD_URL = `https://asap.test/evidence/${SHA256}.jpg`;
const PREVIEW_URL = 'blob:asap-preview-1';

const createObjectURL = vi.fn(() => PREVIEW_URL);
const revokeObjectURL = vi.fn();

interface Props {
  bondWei: bigint;
  bondReady: boolean;
  balanceWei?: bigint | null;
  disabled: boolean;
  onClaim: (evidence: string) => void;
}

function setup(overrides: Partial<Props> = {}) {
  const onClaim = vi.fn();
  const props: Props = {
    bondWei: BOND,
    bondReady: true,
    balanceWei: 1_000n * 10n ** 18n,
    disabled: false,
    onClaim,
    ...overrides,
  };
  const view = render(<EvidencePicker {...props} />);
  return { ...view, onClaim, props: { onClaim } };
}

function claimButton(): HTMLElement {
  return screen.getByRole('button', { name: /^claim/i });
}

function fileInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
}

function manualInput(): HTMLInputElement {
  return screen.getByPlaceholderText('or paste an IPFS CID / URL') as HTMLInputElement;
}

beforeEach(() => {
  compressImageMock.mockReset();
  uploadEvidenceBlobMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  // jsdom ships no object-URL implementation; the component needs one for the preview.
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
});

describe('EvidencePicker — claim gating', () => {
  it('starts disabled with no evidence', () => {
    setup();

    expect(claimButton()).toBeDisabled();
    expect(claimButton()).toHaveTextContent(/Claim · bond 0\.050 MON/);
  });

  it('enables the claim only once a wallet is connected, the bond is ready and evidence exists', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(manualInput(), 'ipfs://bafybeigdyrzt');
    expect(claimButton()).toBeEnabled();
  });

  it('keeps the claim disabled while no wallet is connected', async () => {
    const user = userEvent.setup();
    setup({ disabled: true });

    await user.type(manualInput(), 'ipfs://bafybeigdyrzt');
    expect(claimButton()).toBeDisabled();
  });

  it('keeps the claim disabled and shows an em dash when the bond is not ready', async () => {
    const user = userEvent.setup();
    setup({ bondWei: 0n, bondReady: false });

    await user.type(manualInput(), 'ipfs://bafybeigdyrzt');

    expect(claimButton()).toBeDisabled();
    expect(claimButton()).toHaveTextContent(/Claim · bond — MON/);
    expect(claimButton().textContent).not.toMatch(/0\.000/);
  });

  it('treats whitespace-only evidence as no evidence', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(manualInput(), '   ');
    expect(claimButton()).toBeDisabled();
  });

  it('disables the claim again when the pasted reference is cleared', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(manualInput(), 'ipfs://bafybeigdyrzt');
    expect(claimButton()).toBeEnabled();

    await user.clear(manualInput());
    expect(claimButton()).toBeDisabled();
  });
});

describe('EvidencePicker — file inputs', () => {
  it('renders exactly two file inputs: picker and rear camera', () => {
    const { container } = setup();
    const inputs = fileInputs(container);

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAttribute('accept', 'image/*');
    expect(inputs[0]).not.toHaveAttribute('capture');

    expect(inputs[1]).toHaveAttribute('accept', 'image/*');
    expect(inputs[1]).toHaveAttribute('capture', 'environment');
  });

  it('keeps both inputs in the layout — never display:none, never hidden', () => {
    const { container } = setup();

    for (const input of fileInputs(container)) {
      expect(input.className).toContain('ev-input');
      expect(input).not.toHaveAttribute('hidden');
      expect(input.hidden).toBe(false);
      expect(input.style.display).not.toBe('none');
      expect(window.getComputedStyle(input).display).not.toBe('none');
      expect(input.isConnected).toBe(true);
    }
  });

  it('nests the native input inside its control, so no script has to open the picker', () => {
    const { container } = setup();
    const [picker, camera] = fileInputs(container);

    // A programmatic `input.click()` on a visually hidden input is ignored by
    // Safari and several WebViews. The input must BE the click target instead.
    for (const input of [picker!, camera!]) {
      const label = input.closest('label');
      expect(label).not.toBeNull();
      expect(label).toHaveClass('ev-btn');
      expect(label).toContainElement(input);
      expect(window.getComputedStyle(input).pointerEvents).not.toBe('none');
    }
  });
});

describe('EvidencePicker — upload success', () => {
  it('shows the preview, the digest label, enables the claim and passes the URL to onClaim', async () => {
    const user = userEvent.setup();
    const compressed = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    compressImageMock.mockResolvedValue(compressed);
    uploadEvidenceBlobMock.mockResolvedValue({ url: UPLOAD_URL, sha256: SHA256, bytes: 3 });

    const { container, onClaim } = setup();
    const file = new File([new Uint8Array([9, 9, 9])], 'burn.png', { type: 'image/png' });

    fireEvent.change(fileInputs(container)[0]!, { target: { files: [file] } });

    const preview = await screen.findByAltText('evidence preview');
    expect(preview).toHaveAttribute('src', PREVIEW_URL);
    expect(createObjectURL).toHaveBeenCalledWith(compressed);

    await waitFor(() => {
      expect(screen.getByText(`Stored · sha256 ${SHA256.slice(0, 12)}…`)).toBeInTheDocument();
    });
    expect(compressImageMock).toHaveBeenCalledWith(file);
    expect(uploadEvidenceBlobMock).toHaveBeenCalledWith(compressed);

    expect(claimButton()).toBeEnabled();
    await user.click(claimButton());

    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(onClaim).toHaveBeenCalledWith(UPLOAD_URL);
    expect(onClaim).not.toHaveBeenCalledWith('');
  });

  it('does the same through the camera input', async () => {
    const compressed = new Blob([new Uint8Array([4, 5, 6])], { type: 'image/jpeg' });
    compressImageMock.mockResolvedValue(compressed);
    uploadEvidenceBlobMock.mockResolvedValue({ url: UPLOAD_URL, sha256: SHA256, bytes: 3 });

    const { container } = setup();
    const file = new File([new Uint8Array([7])], 'camera.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInputs(container)[1]!, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(`Stored · sha256 ${SHA256.slice(0, 12)}…`)).toBeInTheDocument();
    });
    expect(claimButton()).toBeEnabled();
  });
});

describe('EvidencePicker — upload failure', () => {
  it('keeps the claim disabled and shows the error when the upload is rejected', async () => {
    compressImageMock.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    uploadEvidenceBlobMock.mockRejectedValue(new Error('network down'));

    const { container, onClaim } = setup();
    fireEvent.change(fileInputs(container)[0]!, {
      target: { files: [new File([new Uint8Array([9])], 'burn.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(
        screen.getByText('Upload failed: network down — paste a URL instead.'),
      ).toBeInTheDocument();
    });

    expect(claimButton()).toBeDisabled();
    fireEvent.click(claimButton());
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('sends the original file when compression fails but the format is readable', async () => {
    compressImageMock.mockRejectedValue(new Error('canvas exhausted'));
    uploadEvidenceBlobMock.mockResolvedValue({ url: UPLOAD_URL, sha256: SHA256, bytes: 9 });

    const { container } = setup();
    const original = new File([new Uint8Array([9])], 'burn.png', { type: 'image/png' });
    fireEvent.change(fileInputs(container)[0]!, { target: { files: [original] } });

    await waitFor(() => {
      expect(screen.getByText(`Stored · sha256 ${SHA256.slice(0, 12)}…`)).toBeInTheDocument();
    });
    // a phone photo the canvas could not decode must not block the claim
    expect(uploadEvidenceBlobMock).toHaveBeenCalledWith(original);
    expect(claimButton()).toBeEnabled();
  });

  it('explains an unreadable format instead of failing silently', async () => {
    compressImageMock.mockRejectedValue(new Error('decode failed'));

    const { container } = setup();
    fireEvent.change(fileInputs(container)[0]!, {
      target: { files: [new File([new Uint8Array([9])], 'IMG_0001.HEIC', { type: 'image/heic' })] },
    });

    await waitFor(() => {
      expect(screen.getByText(/image\/heic cannot be read by this browser/)).toBeInTheDocument();
    });
    expect(claimButton()).toBeDisabled();
    expect(uploadEvidenceBlobMock).not.toHaveBeenCalled();
    expect(screen.queryByAltText('evidence preview')).not.toBeInTheDocument();
  });

  it('recovers when a URL is pasted after a failed upload', async () => {
    const user = userEvent.setup();
    compressImageMock.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    uploadEvidenceBlobMock.mockRejectedValue(new Error('boom'));

    const { container, onClaim } = setup();
    fireEvent.change(fileInputs(container)[0]!, {
      target: { files: [new File([new Uint8Array([9])], 'burn.png', { type: 'image/png' })] },
    });
    await waitFor(() => {
      expect(screen.getByText(/Upload failed: boom/)).toBeInTheDocument();
    });

    await user.type(manualInput(), 'ipfs://bafyfallback');
    expect(claimButton()).toBeEnabled();

    await user.click(claimButton());
    expect(onClaim).toHaveBeenCalledWith('ipfs://bafyfallback');
  });
});

describe('EvidencePicker — onClaim contract', () => {
  it('never calls onClaim with an empty string', async () => {
    const { onClaim } = setup();

    fireEvent.click(claimButton());
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('passes the trimmed manual reference', async () => {
    const user = userEvent.setup();
    const { onClaim } = setup();

    await user.type(manualInput(), '  ipfs://bafytrimmed  ');
    await user.click(claimButton());

    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(onClaim).toHaveBeenCalledWith('ipfs://bafytrimmed');
  });
});


describe('EvidencePicker — wallet balance', () => {
  it('keeps the claim disabled when the wallet cannot cover the bond', async () => {
    const user = userEvent.setup();
    const { onClaim } = setup({ balanceWei: 1n });

    await user.type(screen.getByPlaceholderText(/paste an IPFS CID/i), 'ipfs://bafy-test');

    expect(screen.getByText(/Not enough MON for the bond/i)).toBeInTheDocument();
    expect(claimButton()).toBeDisabled();
    fireEvent.click(claimButton());
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('allows the claim once the balance covers the bond', async () => {
    const user = userEvent.setup();
    setup({ balanceWei: BOND });

    await user.type(screen.getByPlaceholderText(/paste an IPFS CID/i), 'ipfs://bafy-test');

    expect(screen.queryByText(/Not enough MON/i)).not.toBeInTheDocument();
    expect(claimButton()).toBeEnabled();
  });
});
