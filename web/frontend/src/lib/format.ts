/**
 * Pure display formatting. No DOM, no chain, no React — safe to unit test.
 */

import { formatEther, parseEther } from 'viem';

/** `0x1234…abcd`. Returns an empty string for a missing address. */
export function shortAddress(address?: string | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** `0x8b1899e16e…438144` — a bytes32 evidence hash, shortened for the receipt. */
export function shortHash(hash?: string | null, lead = 10, tail = 6): string {
  if (!hash) return '';
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/**
 * Wei → MON with 3 decimals, e.g. `0.050`. Pure bigint maths so no precision
 * loss on large pools.
 */
export function formatMon(wei: bigint): string {
  return Number(formatEther(wei)).toFixed(3);
}

/** Wei → `0.050 MON`, or an em dash when there is no pool. */
export function formatMonOrDash(wei: bigint | null | undefined): string {
  if (wei === null || wei === undefined || wei === 0n) return '—';
  return `${formatMon(wei)} MON`;
}

/** FRP in MW, rounded for display: `42 MW`. */
export function formatFrp(frp: number): string {
  return `${frp.toFixed(0)} MW`;
}

/** `-2.1234, 113.5678` — the detail panel uses 4 decimals. */
export function formatCoords(lat: number, lon: number, decimals = 4): string {
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}

/** Detection time in Asia/Jakarta, e.g. `24 Okt, 13.05`. */
export function formatTimeWIB(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Kilobyte label for the upload progress line: `143 KB`. */
export function formatKilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** `sha256 4f9c1a8b2d3e…` for the stored-evidence confirmation. */
export function formatSha256Prefix(sha256: string, length = 12): string {
  return `sha256 ${sha256.slice(0, length)}…`;
}

/**
 * User input → wei. Returns null for anything `parseEther` rejects, so the
 * "Open bounty" button can disable instead of throwing at click time.
 */
export function parseMonInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const wei = parseEther(trimmed);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

/** Hours input → seconds, null when the value is not a positive number. */
export function parseHoursInput(value: string): number | null {
  const hours = Number(value.trim());
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(hours * 3600);
}
