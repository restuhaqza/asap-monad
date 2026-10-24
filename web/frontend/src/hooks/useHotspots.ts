/**
 * Reads hotspots and bounties straight from Monad.
 *
 * Pacing is not optional: the public RPC allows 15 requests/second, caps
 * `eth_getLogs` at 100 blocks and returned inconsistent results through
 * Multicall3. So state is read one id at a time in small waves, painted as each
 * wave lands, and cached locally so a reload is instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { pickLargestPoolPerHotspot } from '../lib/bounties';
import { readBounty, readBountyCount, readHotspot, readHotspotCount } from '../lib/chain';
import {
  BOUNTY_WAVE_DELAY_MS,
  BOUNTY_WAVE_SIZE,
  HOTSPOT_RETRY_DELAY_MS,
  HOTSPOT_RETRY_WAVE_SIZE,
  HOTSPOT_WAVE_DELAY_MS,
  HOTSPOT_WAVE_SIZE,
  MAX_SHOWN,
} from '../lib/config';
import { errorMessage } from '../lib/errors';
import { readHotspotCache, writeHotspotCache } from '../lib/hotspot-cache';
import type { Bounty, Hotspot } from '../lib/types';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Ids `from..to` inclusive. */
export function rangeInclusive(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

export interface HotspotsData {
  hotspots: Hotspot[];
  byId: Map<number, Hotspot>;
  bounties: Bounty[];
  /** hotspotId → the bounty with the LARGEST pool for that hotspot. */
  byHotspot: Map<number, Bounty>;
  totalCount: number;
  loading: boolean;
  error: string | null;
  refreshBounties: () => Promise<void>;
}

export function useHotspots(): HotspotsData {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hotspotRef = useRef<Map<number, Hotspot>>(new Map());
  const alive = useRef(true);

  const paint = useCallback(() => {
    if (alive.current) setHotspots([...hotspotRef.current.values()]);
  }, []);

  const refreshBounties = useCallback(async () => {
    const total = await readBountyCount();
    const collected: Bounty[] = [];

    for (let start = 1; start <= total; start += BOUNTY_WAVE_SIZE) {
      const ids = rangeInclusive(start, Math.min(start + BOUNTY_WAVE_SIZE - 1, total));
      const wave = await Promise.all(ids.map((id) => readBounty(id).catch(() => null)));

      for (const bounty of wave) if (bounty) collected.push(bounty);
      if (!alive.current) return;

      setBounties([...collected]);
      if (start + BOUNTY_WAVE_SIZE <= total) await sleep(BOUNTY_WAVE_DELAY_MS);
    }
  }, []);

  useEffect(() => {
    alive.current = true;

    const loadWave = async (ids: number[]): Promise<void> => {
      const wave = await Promise.all(ids.map((id) => readHotspot(id).catch(() => null)));
      if (!alive.current) return;

      let added = false;
      wave.forEach((hotspot, index) => {
        const id = ids[index];
        if (!hotspot || id === undefined) return;
        hotspotRef.current.set(id, hotspot);
        added = true;
      });
      if (added) paint();
    };

    const loadWaves = async (ids: number[], size: number, delay: number): Promise<void> => {
      for (let index = 0; index < ids.length; index += size) {
        if (!alive.current) return;
        await loadWave(ids.slice(index, index + size));
        if (index + size < ids.length) await sleep(delay);
      }
    };

    const run = async (): Promise<void> => {
      // A cached render must be instant: paint before any network call.
      const cached = readHotspotCache();
      if (cached) {
        for (const row of cached.rows) hotspotRef.current.set(row.id, row);
        setTotalCount(cached.count);
        paint();
      }

      try {
        const count = await readHotspotCount();
        if (!alive.current) return;
        setTotalCount(count);

        // The cache is keyed by count: a mismatch means the batch grew.
        if (cached && cached.count !== count) {
          hotspotRef.current.clear();
          paint();
        }

        await refreshBounties();
        if (!alive.current) return;

        // Ids are ordered by FRP at publish time, so the first N are the biggest
        // fires. The cap is total, not per pass: a React strict-mode remount must
        // not push the count past MAX_SHOWN.
        const remaining = Math.max(0, MAX_SHOWN - hotspotRef.current.size);
        const ids = rangeInclusive(1, count)
          .filter((id) => !hotspotRef.current.has(id))
          .slice(0, remaining);
        await loadWaves(ids, HOTSPOT_WAVE_SIZE, HOTSPOT_WAVE_DELAY_MS);

        // One retry pass for whatever the rate limiter rejected.
        const missing = ids.filter((id) => !hotspotRef.current.has(id));
        await loadWaves(missing, HOTSPOT_RETRY_WAVE_SIZE, HOTSPOT_RETRY_DELAY_MS);

        if (!alive.current) return;
        paint();
        writeHotspotCache([...hotspotRef.current.values()], count);
      } catch (cause) {
        if (!alive.current) return;
        setError(errorMessage(cause, 'RPC error'));
      } finally {
        if (alive.current) setLoading(false);
      }
    };

    void run();

    return () => {
      alive.current = false;
    };
  }, [paint, refreshBounties]);

  const byId = useMemo(() => {
    const map = new Map<number, Hotspot>();
    for (const hotspot of hotspots) map.set(hotspot.id, hotspot);
    return map;
  }, [hotspots]);

  const byHotspot = useMemo(() => pickLargestPoolPerHotspot(bounties), [bounties]);

  return { hotspots, byId, bounties, byHotspot, totalCount, loading, error, refreshBounties };
}
