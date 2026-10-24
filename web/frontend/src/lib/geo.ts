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

/** Marker radius grows with fire radiative power, clamped to 3–10 px. */
export function markerRadius(frp: number): number {
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
