/** Header: brand, live stats, network pill, connect button. */

import { CHAIN } from '../lib/config';
import { formatMon, shortAddress } from '../lib/format';
import { Stats } from './Stats';

interface HeaderProps {
  hotspotCount: number;
  openCount: number;
  escrowWei: bigint;
  loading: boolean;
  account: `0x${string}` | null;
  /** Native MON balance, null until read. */
  balance: bigint | null;
  connecting: boolean;
  onConnect: () => void;
}

export function Header({
  hotspotCount,
  openCount,
  escrowWei,
  loading,
  account,
  balance,
  connecting,
  onConnect,
}: HeaderProps) {
  return (
    <header>
      <div className="brand">
        <div className="mark">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3c0 4-4 4.5-4 8a4 4 0 0 0 8 0c0-1.5-1-2.5-1-2.5S16 10 16 12a4 4 0 1 1-8 0" />
            <path d="M4 20h16" opacity=".4" />
          </svg>
        </div>
        <div>
          <h1>ASAP</h1>
          <p>FIRE RESPONSE BOUNTY · MONAD</p>
        </div>
      </div>

      <Stats
        hotspotCount={hotspotCount}
        openCount={openCount}
        escrowWei={escrowWei}
        loading={loading}
      />

      <div className="spacer" />

      <a className="ghost-link" href="/start">
        Why ASAP
      </a>

      {account ? (
        <span className="balance" title={`Wallet balance on ${CHAIN.name}`} data-testid="balance">
          <span className="mono">{balance === null ? '—' : formatMon(balance)}</span> MON
        </span>
      ) : null}

      <div className="net">
        <span className="dot" />
        <span>{CHAIN.name}</span>
      </div>

      <button
        type="button"
        id="connect"
        className={account ? 'btn' : 'btn btn-primary'}
        onClick={onConnect}
        disabled={connecting}
      >
        {account ? shortAddress(account) : connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    </header>
  );
}
