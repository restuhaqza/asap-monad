/** The four live counters in the header. */

import { STATUS_COLORS } from '../lib/config';
import { formatMon } from '../lib/format';

interface StatsProps {
  hotspotCount: number;
  openCount: number;
  expiredCount: number;
  escrowWei: bigint;
  /** True until the first wave (or the cache) has landed. */
  loading: boolean;
}

export function Stats({ hotspotCount, openCount, expiredCount, escrowWei, loading }: StatsProps) {
  return (
    <div className="stats">
      <div className="stat">
        <b className="mono">{loading && hotspotCount === 0 ? '—' : hotspotCount}</b>
        <span>hotspots on-chain</span>
      </div>
      <div className="stat">
        <b className="mono" style={{ color: 'var(--haze)' }}>
          {loading && openCount === 0 ? '—' : openCount}
        </b>
        <span>bounties open</span>
      </div>
      <div className="stat">
        <b className="mono" style={{ color: STATUS_COLORS[4] }}>
          {loading && expiredCount === 0 ? '—' : expiredCount}
        </b>
        <span>fires with no responder</span>
      </div>
      <div className="stat">
        <b className="mono">{escrowWei > 0n ? formatMon(escrowWei) : loading ? '—' : '0.000'}</b>
        <span>MON in escrow</span>
      </div>
    </div>
  );
}
