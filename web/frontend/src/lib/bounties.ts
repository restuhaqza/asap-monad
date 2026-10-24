/**
 * Pure bounty helpers: status mapping, the "largest pool wins" rule and the
 * header aggregates. One hotspot can collect several bounties over time, and
 * only the biggest one should be surfaced in the rail and the detail panel.
 */

import { STATUS_COLORS, STATUS_EXPIRED, STATUS_LABELS } from './config';
import type { Bounty, Hotspot } from './types';

export const NO_BOUNTY = 0;
export const STATUS_OPEN = 1;
export const STATUS_CLAIMED = 2;
export const STATUS_VERIFIED = 3;

/** Hex colour for an on-chain status value. */
export function statusColor(status: number): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS[NO_BOUNTY];
}

/** Fallback label (the rail and pill show "no responder" for expired). */
export function statusLabel(status: number): string {
  return STATUS_LABELS[status] ?? STATUS_LABELS[NO_BOUNTY];
}

/** Label used in the rail and the detail pill. */
export function displayStatusLabel(status: number): string {
  return status === STATUS_EXPIRED ? 'no responder' : statusLabel(status);
}

/**
 * One hotspot may have several bounties. Keep the LARGEST pool, not the most
 * recent one — that is what the responder is actually competing for.
 */
export function pickLargestPoolPerHotspot(bounties: readonly Bounty[]): Map<number, Bounty> {
  const byHotspot = new Map<number, Bounty>();
  for (const bounty of bounties) {
    const current = byHotspot.get(bounty.hotspotId);
    if (!current || bounty.pool > current.pool) byHotspot.set(bounty.hotspotId, bounty);
  }
  return byHotspot;
}

/** Resolve the bounty shown for a hotspot (largest pool wins). */
export function bountyFor(
  hotspotId: number,
  byHotspot: Map<number, Bounty>,
): Bounty | undefined {
  return byHotspot.get(hotspotId);
}

/** On-chain status for a hotspot, or 0 when it has no bounty. */
export function hotspotStatus(hotspotId: number, byHotspot: Map<number, Bounty>): number {
  return byHotspot.get(hotspotId)?.status ?? NO_BOUNTY;
}

/** Escrow for a hotspot, or 0n when it has no bounty. */
export function hotspotPool(hotspotId: number, byHotspot: Map<number, Bounty>): bigint {
  return byHotspot.get(hotspotId)?.pool ?? 0n;
}

/** `Record<hotspotId, status>` for the map layer and the rail. */
export function statusMap(byHotspot: Map<number, Bounty>): Record<number, number> {
  const map: Record<number, number> = {};
  for (const [hotspotId, bounty] of byHotspot) map[hotspotId] = bounty.status;
  return map;
}

/** Hotspots sorted by fire radiative power, biggest first. */
export function sortByFrpDesc(hotspots: readonly Hotspot[]): Hotspot[] {
  return [...hotspots].sort((a, b) => b.frp - a.frp);
}

/** Header stat: how many bounties are still claimable. */
export function countOpen(bounties: readonly Bounty[]): number {
  return bounties.filter((bounty) => bounty.status === STATUS_OPEN).length;
}

/**
 * Header stat: how many bounties expired with nobody credible showing up.
 * This is the accountability number — a fire that was funded and ignored.
 */
export function countExpired(bounties: readonly Bounty[]): number {
  return bounties.filter((bounty) => bounty.status === STATUS_EXPIRED).length;
}

/** Header stat: everything currently sitting in escrow, in wei. */
export function totalEscrow(bounties: readonly Bounty[]): bigint {
  return bounties.reduce((sum, bounty) => sum + bounty.pool, 0n);
}
