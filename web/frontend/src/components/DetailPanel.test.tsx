import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readRequiredBondMock, useRequiredBondMock, useClaimMock } = vi.hoisted(() => ({
  readRequiredBondMock: vi.fn(),
  useRequiredBondMock: vi.fn(),
  useClaimMock: vi.fn(),
}));

vi.mock('../lib/chain', () => ({ readRequiredBond: readRequiredBondMock }));
vi.mock('../hooks/useRequiredBond', () => ({ useRequiredBond: useRequiredBondMock }));
vi.mock('../hooks/useClaim', () => ({ useClaim: useClaimMock }));

import { DetailPanel } from './DetailPanel';
import { STATUS_CLAIMED, STATUS_OPEN, STATUS_VERIFIED } from '../lib/bounties';
import { STATUS_EXPIRED } from '../lib/config';
import type { Bounty, Hotspot } from '../lib/types';

const MON = 10n ** 18n;
const BOND = 5n * 10n ** 16n; // 0.05 MON
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678' as const;
const BACKER = '0x9999999999999999999999999999999999999999' as const;
const CAPTURED_AT = 1_792_821_900;

const hotspot: Hotspot = {
  id: 5,
  lat: -2.1234,
  lon: 113.5678,
  latE6: -2_123_400,
  lonE6: 113_567_800,
  frp: 42.4,
  acqTime: 1_792_821_900,
  confidence: 90,
};

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    bountyId: 11,
    hotspotId: 5,
    backer: BACKER,
    pool: 8n * MON,
    deadline: 1_792_900_000,
    activeClaim: 0,
    status: STATUS_OPEN,
    ...overrides,
  };
}

function setup(
  options: {
    bountyValue?: Bounty | null;
    isVerifier?: boolean;
    account?: `0x${string}` | null;
    bond?: bigint;
    bondReady?: boolean;
  } = {},
) {
  const {
    bountyValue = null,
    isVerifier = false,
    account = ACCOUNT,
    bond = BOND,
    bondReady = true,
  } = options;

  useRequiredBondMock.mockReturnValue({ bond, ready: bondReady });

  const handlers = { onOpenBounty: vi.fn(), onClaim: vi.fn(), onAttest: vi.fn() };
  render(
    <DetailPanel
      hotspot={hotspot}
      bounty={bountyValue}
      isVerifier={isVerifier}
      account={account}
      onOpenBounty={handlers.onOpenBounty}
      onClaim={handlers.onClaim}
      onAttest={handlers.onAttest}
    />,
  );
  return handlers;
}

beforeEach(() => {
  useRequiredBondMock.mockReset();
  useClaimMock.mockReset();
  useClaimMock.mockReturnValue(null);
  readRequiredBondMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DetailPanel — no bounty', () => {
  it('shows the open-bounty form and no claim control', () => {
    setup({ bountyValue: null });

    expect(screen.getByLabelText('Bounty amount in MON')).toBeInTheDocument();
    expect(screen.getByLabelText('Bounty time to live in hours')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^claim/i })).not.toBeInTheDocument();
    expect(screen.getByText('No bounty')).toBeInTheDocument();
    expect(screen.getByText('Bond required').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('Bounty pool').nextElementSibling).toHaveTextContent('—');
  });

  it('routes the form submit to onOpenBounty with hotspot id, ttl seconds and wei', async () => {
    const user = userEvent.setup();
    const { onOpenBounty } = setup({ bountyValue: null });

    const amount = screen.getByLabelText('Bounty amount in MON');
    const ttl = screen.getByLabelText('Bounty time to live in hours');
    await user.clear(amount);
    await user.type(amount, '0.25');
    await user.clear(ttl);
    await user.type(ttl, '12');

    await user.click(screen.getByRole('button', { name: /open bounty/i }));

    expect(onOpenBounty).toHaveBeenCalledWith(5, 43_200, 25n * 10n ** 16n);
  });
});

describe('DetailPanel — status Open', () => {
  it('renders the evidence picker with the real bond', () => {
    setup({ bountyValue: bounty({ status: STATUS_OPEN }) });

    const claim = screen.getByRole('button', { name: /^claim/i });
    expect(claim).toBeDisabled();
    expect(claim).toHaveTextContent(/Claim · bond 0\.050 MON/);
    expect(screen.getByText('Bond required').nextElementSibling).toHaveTextContent(
      '0.050 MON',
    );
  });

  it('passes the claim through with the hotspot coordinates and the read bond', async () => {
    const user = userEvent.setup();
    vi.spyOn(Date, 'now').mockReturnValue(CAPTURED_AT * 1000);
    const { onClaim } = setup({ bountyValue: bounty({ status: STATUS_OPEN }) });

    await user.type(
      screen.getByPlaceholderText('or paste an IPFS CID / URL'),
      'ipfs://bafyevidence',
    );
    await user.click(screen.getByRole('button', { name: /^claim/i }));

    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(onClaim).toHaveBeenCalledWith(
      11,
      'ipfs://bafyevidence',
      -2_123_400,
      113_567_800,
      CAPTURED_AT,
      BOND,
    );
  });

  it('keeps the claim disabled and shows an em dash while the bond is unknown', async () => {
    const user = userEvent.setup();
    setup({ bountyValue: bounty({ status: STATUS_OPEN }), bond: 0n, bondReady: false });

    await user.type(
      screen.getByPlaceholderText('or paste an IPFS CID / URL'),
      'ipfs://bafyevidence',
    );

    const claim = screen.getByRole('button', { name: /^claim/i });
    expect(claim).toBeDisabled();
    expect(claim).toHaveTextContent(/Claim · bond — MON/);
    expect(screen.getByText('Bond required').nextElementSibling).toHaveTextContent('—');
  });

  it('disables the claim when no wallet is connected', async () => {
    const user = userEvent.setup();
    setup({ bountyValue: bounty({ status: STATUS_OPEN }), account: null });

    await user.type(
      screen.getByPlaceholderText('or paste an IPFS CID / URL'),
      'ipfs://bafyevidence',
    );

    expect(screen.getByRole('button', { name: /^claim/i })).toBeDisabled();
    expect(
      screen.getByText('Connect a wallet on Monad Testnet to fund, claim or attest.'),
    ).toBeInTheDocument();
  });
});

describe('DetailPanel — status Claimed', () => {
  const claimed = () => bounty({ status: STATUS_CLAIMED, activeClaim: 7 });

  it('wires Approve and Reject to onAttest with the active claim id for a verifier', async () => {
    const { onAttest } = setup({ bountyValue: claimed(), isVerifier: true });

    expect(screen.getByText('Claimed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^approve/i }));
    expect(onAttest).toHaveBeenLastCalledWith(7, true);

    await userEvent.click(screen.getByRole('button', { name: /^reject/i }));
    expect(onAttest).toHaveBeenLastCalledWith(7, false);

    expect(onAttest).toHaveBeenCalledTimes(2);
  });

  it('shows a quorum hint and no buttons for a non-verifier', () => {
    setup({ bountyValue: claimed(), isVerifier: false });

    expect(
      screen.getByText(/Claim #7 is awaiting verifier quorum/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^claim/i })).not.toBeInTheDocument();
  });

  it('does not offer the evidence picker or the open-bounty form while claimed', () => {
    setup({ bountyValue: claimed(), isVerifier: true });

    expect(screen.queryByText('Choose file')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Bounty amount in MON')).not.toBeInTheDocument();
  });
});

describe('DetailPanel — status Verified', () => {
  it('explains that the responder has been paid', () => {
    setup({ bountyValue: bounty({ status: STATUS_VERIFIED, activeClaim: 7 }) });

    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(
      screen.getByText(/Answered\. Someone proved they reached this spot, and the payout/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
  });
});

describe('DetailPanel — status Expired', () => {
  it('explains the refund and labels the row "no responder"', () => {
    setup({ bountyValue: bounty({ status: STATUS_EXPIRED }) });

    expect(screen.getByText('no responder')).toBeInTheDocument();
    expect(
      screen.getByText(/Nobody answered this fire before the deadline\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^claim/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
  });
});

describe('DetailPanel — header facts', () => {
  it('renders coordinates, FRP, pool and the bounty trail', () => {
    setup({ bountyValue: bounty({ status: STATUS_OPEN }) });

    expect(screen.getByText('#5', { selector: '.mono' })).toBeInTheDocument();
    expect(screen.getByText('-2.1234, 113.5678')).toBeInTheDocument();
    expect(screen.getByText('42 MW')).toBeInTheDocument();
    expect(screen.getByText('8.000 MON')).toBeInTheDocument();
    expect(screen.getByText(/#11/)).toBeInTheDocument();
  });

  it('leads with the nearest town, not with a coordinate pair', () => {
    setup({ bountyValue: bounty({ status: STATUS_OPEN }) });

    // -2.1234, 113.5678 is roughly 40 km west of Palangka Raya.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/Palangka Raya/);
    expect(screen.getByText(/Central Kalimantan/)).toBeInTheDocument();
    expect(screen.getByText(/^≈\d+ km [NSEW]{1,2} of Palangka Raya$/)).toBeInTheDocument();
  });

  it('says what the fire means and what would answer it', () => {
    setup({ bountyValue: bounty({ status: STATUS_OPEN }) });

    expect(
      screen.getByText(/8\.000 MON is waiting for the first responder who can prove/),
    ).toBeInTheDocument();
    expect(screen.getByText(/back if approved · lost if false/)).toBeInTheDocument();
  });

  it('explains an unfunded fire without jargon', () => {
    setup({ bountyValue: null });

    expect(
      screen.getByText(/Nobody has put money behind it yet — opening a bounty is what makes/),
    ).toBeInTheDocument();
    expect(screen.getByText('nobody has funded this fire yet')).toBeInTheDocument();
  });

  it('ranks the fire against the ones already loaded, when given a rank', () => {
    useRequiredBondMock.mockReturnValue({ bond: BOND, ready: true });
    render(
      <DetailPanel
        hotspot={hotspot}
        bounty={bounty({ status: STATUS_OPEN })}
        isVerifier={false}
        account={ACCOUNT}
        hotterThanPct={78}
        loadedCount={80}
        onOpenBounty={vi.fn()}
        onClaim={vi.fn()}
        onAttest={vi.fn()}
      />,
    );

    expect(
      screen.getByText('stronger than 78% of the 80 fires here'),
    ).toBeInTheDocument();
  });

  it('links the hotspot record when there is no bounty', () => {
    setup({ bountyValue: null });

    expect(screen.getByText(/Hotspot record/)).toBeInTheDocument();
  });

  it('does not fire a handler merely by rendering', () => {
    const { onClaim, onAttest, onOpenBounty } = setup({ bountyValue: bounty() });

    fireEvent.click(screen.getByText('Bounty pool'));

    expect(onClaim).not.toHaveBeenCalled();
    expect(onAttest).not.toHaveBeenCalled();
    expect(onOpenBounty).not.toHaveBeenCalled();
  });
});

describe('DetailPanel — bottom sheet dismissal (mobile)', () => {
  beforeEach(() => {
    useRequiredBondMock.mockReturnValue({ bond: BOND, ready: true });
  });

  const props = {
    hotspot,
    bounty: null,
    isVerifier: false,
    account: ACCOUNT,
    onOpenBounty: vi.fn(),
    onClaim: vi.fn(),
    onAttest: vi.fn(),
  };

  it('renders no close control when onClose is not supplied (desktop stays inline)', () => {
    render(<DetailPanel {...props} />);

    expect(screen.queryByLabelText('Close details')).not.toBeInTheDocument();
  });

  it('shows a close control and reports dismissal when onClose is supplied', async () => {
    const onClose = vi.fn();
    render(<DetailPanel {...props} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('Close details'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
