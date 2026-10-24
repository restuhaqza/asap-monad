/** Right-rail list: one row per loaded hotspot, biggest fire first, by place. */

import { useEffect, useRef } from 'react';

import { displayStatusLabel, hotspotPool, hotspotStatus, statusColor } from '../lib/bounties';
import { formatFrp, formatMonOrDash, relativeTime } from '../lib/format';
import { formatPlaceRail, nearestPlace } from '../lib/places';
import type { Bounty, Hotspot } from '../lib/types';

interface HotspotListProps {
  /** Already sorted by FRP, descending. */
  hotspots: Hotspot[];
  byHotspot: Map<number, Bounty>;
  selected: number | null;
  onSelect: (id: number) => void;
}

export function HotspotList({ hotspots, byHotspot, selected, onSelect }: HotspotListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Tapping a dot on the map has to answer "which row is this?" — otherwise the
  // highlighted row can be a hundred rows down and the rail looks untouched.
  useEffect(() => {
    if (selected === null) return;
    const row = listRef.current?.querySelector('.row.sel');
    // jsdom has no scrollIntoView; a browser always does.
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="list" id="list" ref={listRef}>
      {hotspots.map((hotspot) => {
        const status = hotspotStatus(hotspot.id, byHotspot);
        const color = statusColor(status);
        const pool = hotspotPool(hotspot.id, byHotspot);
        const place = nearestPlace(hotspot.lat, hotspot.lon);

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
              <span className="place" title={`${place.province} · hotspot #${hotspot.id}`}>
                {formatPlaceRail(place)}
              </span>
              <span className="sub">
                {formatFrp(hotspot.frp)} · {relativeTime(hotspot.acqTime)}
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
