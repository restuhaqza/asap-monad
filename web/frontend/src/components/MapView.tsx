/**
 * Leaflet map: Esri dark-gray base + reference tiles, one circle marker per
 * loaded hotspot, coloured by on-chain bounty status.
 *
 * The map instance and the marker map live in refs, never in state, so React
 * re-renders never re-create them. Markers are added incrementally as waves of
 * hotspots land; `flyTo` is exposed imperatively for the rail.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import * as L from 'leaflet';

import { statusColor } from '../lib/bounties';
import {
  CHAIN,
  LABEL_MIN_ZOOM,
  MAP_CENTER,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_ZOOM,
  TILES_ATTRIBUTION,
  TILES_BASE,
  TILES_REFERENCE,
} from '../lib/config';
import { relativeTime, formatFrp } from '../lib/format';
import { markerFillOpacity, markerRadius } from '../lib/geo';
import { formatPlaceRail, nearestPlace } from '../lib/places';
import type { Hotspot } from '../lib/types';

interface MapViewProps {
  hotspots: Hotspot[];
  statuses: Record<number, number>;
  selected: number | null;
  hotspotCount: number;
  totalCount: number;
  onSelect: (id: number) => void;
}

export interface MapViewHandle {
  flyTo: (lat: number, lon: number) => void;
  /** Add markers for hotspots that are not on the map yet. */
  drawMarkers: () => void;
  /** Restyle existing markers (status or selection changed). */
  recolor: () => void;
}

/**
 * Hover text for a marker. A dot on a map is anonymous; naming the nearest town
 * is what turns a click into a decision.
 */
function tooltipHtml(lat: number, lon: number, frp: number, acqTime: number): string {
  const place = nearestPlace(lat, lon);
  return [
    `<span style="font-family:'JetBrains Mono',monospace;font-size:10px">${formatPlaceRail(place)}</span>`,
    `<span style="display:block;font-size:9px;opacity:.65;margin-top:2px">${formatFrp(frp)} · ${relativeTime(acqTime)}</span>`,
  ].join('');
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { hotspots, statuses, selected, hotspotCount, totalCount, onSelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<number, L.CircleMarker>());
  const onSelectRef = useRef(onSelect);
  // Latest inputs, so the imperative helpers never capture a stale render.
  const latest = useRef({ hotspots, statuses, selected });

  useEffect(() => {
    latest.current = { hotspots, statuses, selected };
  });

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const drawMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const { hotspots: rows, statuses: state } = latest.current;
    const markers = markersRef.current;

    for (const hotspot of rows) {
      if (markers.has(hotspot.id)) continue;

      const status = state[hotspot.id] ?? 0;
      const color = statusColor(status);
      const marker = L.circleMarker([hotspot.lat, hotspot.lon], {
        radius: markerRadius(hotspot.frp),
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: markerFillOpacity(status),
      }).addTo(map);

      marker.bindTooltip(tooltipHtml(hotspot.lat, hotspot.lon, hotspot.frp, hotspot.acqTime), {
        direction: 'top',
      });
      marker.on('click', () => onSelectRef.current(hotspot.id));
      markers.set(hotspot.id, marker);
    }
  }, []);

  const recolor = useCallback(() => {
    const { statuses: state, selected: current } = latest.current;

    for (const [id, marker] of markersRef.current) {
      const status = state[id] ?? 0;
      const color = statusColor(status);
      const isSelected = current === id;
      marker.setStyle({
        // selected marker keeps its status colour as fill but turns white-edged
        color: isSelected ? '#fff' : color,
        fillColor: color,
        fillOpacity: markerFillOpacity(status),
        weight: isSelected ? 3 : 1,
      });
    }
  }, []);

  const flyTo = useCallback((lat: number, lon: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([lat, lon], Math.max(map.getZoom(), 7), { duration: 0.6 });
  }, []);

  useImperativeHandle(ref, () => ({ flyTo, drawMarkers, recolor }), [drawMarkers, flyTo, recolor]);

  // Create the map once. Guarded for React strict mode's double mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      // a stray two-finger scroll must not teleport the archipelago
      scrollWheelZoom: false,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
    }).setView(MAP_CENTER, MAP_ZOOM);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(TILES_BASE, {
      maxZoom: MAP_MAX_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      attribution: TILES_ATTRIBUTION,
    }).addTo(map);
    // Place names are reference only, and at the national view Esri draws city
    // labels larger than this app's own type — they shout over the dots. So the
    // label layer starts one zoom in, where it recedes, and the rail plus the
    // panel already name every fire.
    L.tileLayer(TILES_REFERENCE, {
      maxZoom: MAP_MAX_ZOOM,
      minZoom: LABEL_MIN_ZOOM,
      opacity: 0.55,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    drawMarkers();
    recolor();
  }, [hotspots, statuses, selected, drawMarkers, recolor]);

  const shown = hotspotCount;
  const total = totalCount || hotspotCount;

  return (
    <div className="map-wrap">
      <div id="map" ref={containerRef} />

      <div className="banner">
        <span className="sw" style={{ background: 'var(--dead)' }} />
        <span>
          Live hotspots · <span className="mono">{shown}</span> of{' '}
          <span className="mono">{total}</span> on {CHAIN.name}
        </span>
      </div>

      <div className="legend">
        <h4>Bounty status</h4>
        <ul>
          <li>
            <span className="sw" style={{ background: '#5b5473' }} />
            No bounty
          </li>
          <li>
            <span className="sw" style={{ background: 'var(--haze)' }} />
            Open
          </li>
          <li>
            <span className="sw" style={{ background: 'var(--blue)' }} />
            Claimed
          </li>
          <li>
            <span className="sw" style={{ background: 'var(--ok)' }} />
            Verified
          </li>
          <li>
            <span className="sw" style={{ background: 'var(--dead)' }} />
            Expired
          </li>
        </ul>
      </div>
    </div>
  );
});
