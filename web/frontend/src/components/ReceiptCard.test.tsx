import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EXPLORER } from '../lib/config';
import type { SettlementReceipt } from '../lib/receipts';
import type { Claim, Hotspot } from '../lib/types';
import { ReceiptCard } from './ReceiptCard';

const RESPONDER = '0xbe500dd19a075af040279612be845563a8a81b73' as const;
const TX = '0x9f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e' as const;
const EVIDENCE = '0x8b1899e16e8ef9dddcab037307ad0d292fe522b5e531ed3f33c239472d438144' as const;
const CAPTURED_AT = 1_792_818_639; // 24 Okt 2026, 12:10 WIB

const hotspot: Hotspot = {
  id: 1,
  lat: -1.42334,
  lon: 104.08295,
  latE6: -1_423_340,
  lonE6: 104_082_950,
  frp: 28.96,
  acqTime: 1_792_711_740,
  confidence: 2,
};

/** Claim #1 as it is on chain, except the coordinates sit ~1.1 km south. */
const claim: Claim = {
  claimId: 1,
  bountyId: 1,
  responder: RESPONDER,
  bond: 0n,
  latE6: -1_433_340,
  lonE6: 104_082_950,
  capturedAt: CAPTURED_AT,
  evidenceHash: EVIDENCE,
  approvals: 2,
  rejections: 0,
  settled: true,
};

const receipt: SettlementReceipt = {
  responder: RESPONDER,
  payout: 1_900_000_000_000_000_000n,
  verifierReward: 100_000_000_000_000_000n,
  txHash: TX,
  blockNumber: 16_000_123,
};

describe('ReceiptCard — payout captured from the settlement receipt', () => {
  it('states the exact amount and links the responder and the payout tx', () => {
    render(<ReceiptCard hotspot={hotspot} claim={claim} receipt={receipt} />);

    expect(screen.getByText('Payment receipt')).toBeInTheDocument();
    expect(screen.getByText('1.900 MON')).toBeInTheDocument();
    expect(screen.getByText('Paid to the responder in the settlement block.')).toBeInTheDocument();

    const responder = screen.getByText('0xbe50…1b73');
    expect(responder).toHaveAttribute('href', `${EXPLORER}/address/${RESPONDER}`);

    expect(screen.getByText('1.1 km')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getByText('0.100 MON')).toBeInTheDocument();
    expect(screen.getByText(/0x8b1899e1…438144/)).toBeInTheDocument();
    expect(screen.getByText(/payout tx 0x9f1c…4d5e/)).toBeInTheDocument();
    expect(screen.getByText(/block 16000123/)).toBeInTheDocument();
  });

  it('offers the evidence hash to the clipboard', async () => {
    render(<ReceiptCard hotspot={hotspot} claim={claim} receipt={receipt} />);

    fireEvent.click(screen.getByLabelText('Copy evidence hash'));

    // jsdom without a clipboard permission rejects, which the card must swallow.
    expect(screen.getByLabelText('Copy evidence hash')).toBeInTheDocument();
  });
});

describe('ReceiptCard — settled before this build', () => {
  it('says so plainly and never invents a payout', () => {
    render(<ReceiptCard hotspot={hotspot} claim={claim} receipt={null} />);

    expect(screen.getByText('settled before this build')).toBeInTheDocument();
    expect(screen.queryByText(/MON$/)).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // verifier reward, unknown
    expect(
      screen.getByText(/Payout amount unknown\. Nobody in this browser waited for the settlement/),
    ).toBeInTheDocument();

    // The facts that are still readable on-chain are shown.
    expect(screen.getByText('0xbe50…1b73')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('renders dashes rather than guesses while the claim is still loading', () => {
    render(<ReceiptCard hotspot={hotspot} claim={null} receipt={null} />);

    expect(screen.getByText('settled before this build')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy evidence hash' })).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });
});
