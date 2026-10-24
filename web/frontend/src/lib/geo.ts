/**
 * Geo helpers: the contract stores coordinates as int32 scaled by 1e6 and the
 * radius check happens on-chain, so the app only needs conversions + a marker
 * radius that reads well at archipelago zoom.
 */

/** int32 scaled by 1e6 → decimal degrees. */
export function fromE6(value: number): number {
  return value / 1e6;
}

/** Decimal degrees → int32 scaled by 1e6, truncated like the pusher does. */
export function toE6(degrees: number): number {
  return Math.trunc(degrees * 1e6);
}

/**
 * Straight-line distance in metres between two 1e6-scaled points, using the
 * same flat-earth approximation as `FireBounty._withinRadius` (1 µ° ≈ 0.11132 m,
 * i.e. 111_320 m per degree on both axes). Kept in one place so the receipt and
 * the contract can never disagree about what "25 km" means.
 */
export function distanceMeters(
  latE6A: number,
  lonE6A: number,
  latE6B: number,
  lonE6B: number,
): number {
  const mLat = ((latE6A - latE6B) * 111_320) / 1e6;
  const mLon = ((lonE6A - lonE6B) * 111_320) / 1e6;
  return Math.sqrt(mLat * mLat + mLon * mLon);
}

/** `340 m` under a kilometre, `12.4 km` above it. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Marker radius grows with fire radiative power, clamped to 3–10 px. */export function markerRadius(frp: number): number {
  return Math.max(3, Math.min(10, 3 + Math.sqrt(Math.max(frp, 0)) / 3));
}

/** Fill opacity: expired fires fade out so live ones read first. */
export function markerFillOpacity(status: number): number {
  return status === 4 ? 0.5 : 0.8;
}

/** `#12 · 42 MW` — the marker tooltip. */
export function markerTooltip(id: number, frp: number): string {
  return `#${id} · ${frp.toFixed(0)} MW`;
}
