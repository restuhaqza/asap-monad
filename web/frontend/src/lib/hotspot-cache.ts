/**
 * localStorage cache of the hotspot rows.
 *
 * Reading 80 hotspots takes ~9 waves, so a reload would otherwise replay the
 * whole pacing dance. The cache is keyed by the on-chain hotspot count and
 * expires after 15 minutes; a stale entry is simply ignored.
 */

import { CACHE_KEY, CACHE_TTL_MS } from './config';
import type { Hotspot } from './types';

export interface HotspotCache {
  /** Timestamp the cache was written, epoch ms. */
  at: number;
  /** `hotspotCount()` at write time — a different count invalidates the rows. */
  count: number;
  rows: Hotspot[];
}

export function isCacheFresh(at: number, now: number, ttl: number = CACHE_TTL_MS): boolean {
  return now - at < ttl && at <= now;
}

export function readHotspotCache(now: number = Date.now()): HotspotCache | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HotspotCache>;
    if (typeof parsed.at !== 'number' || typeof parsed.count !== 'number') return null;
    if (!Array.isArray(parsed.rows)) return null;
    if (!isCacheFresh(parsed.at, now)) return null;
    return { at: parsed.at, count: parsed.count, rows: parsed.rows as Hotspot[] };
  } catch {
    return null;
  }
}

export function writeHotspotCache(rows: Hotspot[], count: number, now: number = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: HotspotCache = { at: now, count, rows };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode or quota — the app simply reloads from chain next time */
  }
}
