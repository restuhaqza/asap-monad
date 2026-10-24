/** Right-rail list: one row per loaded hotspot, biggest fire first. */

import { displayStatusLabel, hotspotPool, hotspotStatus, statusColor } from '../lib/bounties';
import { formatCoords, formatFrp, formatMonOrDash, formatTimeWIB } from '../lib/format';
import type { Bounty, Hotspot } from '../lib/types';

interface HotspotListProps {
  /** Already sorted by FRP, descending. */
  hotspots: Hotspot[];
  byHotspot: Map<number, Bounty>;
  selected: number | null;
  onSelect: (id: number) => void;
}

export function HotspotList({ hotspots, byHotspot, selected, onSelect }: HotspotListProps) {
  return (
    <div className="list" id="list">
      {hotspots.map((hotspot) => {
        const status = hotspotStatus(hotspot.id, byHotspot);
        const color = statusColor(status);
        const pool = hotspotPool(hotspot.id, byHotspot);

        return (
          <button
            key={hotspot.id}
            type="button"
            className={`row${selected === hotspot.id ? ' sel' : ''}`}
            data-id={hotspot.id}
            onClick={() => onSelect(hotspot.id)}
          >
            <span className="sw" style={{ background: color }} />
            <span className="row-main">
              <span className="coords mono">
                {formatCoords(hotspot.lat, hotspot.lon, 3)}
              </span>
              <span className="sub">
                {formatFrp(hotspot.frp)} · {formatTimeWIB(hotspot.acqTime)}
              </span>
            </span>
            <span className="right">
              <span className="coords mono">{formatMonOrDash(pool)}</span>
              <span className="sub" style={{ color }}>
                {displayStatusLabel(status)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
