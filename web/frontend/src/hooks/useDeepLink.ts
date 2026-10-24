/** Deep link `#h=<id>`: select the hotspot as soon as its row is loaded. */

import { useCallback, useEffect, useRef } from 'react';

import { parseHotspotHash } from '../lib/deeplink';
import type { Hotspot } from '../lib/types';

export function useDeepLink(
  hotspots: readonly Hotspot[],
  onSelect: (id: number) => void,
): void {
  const applied = useRef<number | null>(null);

  const apply = useCallback(() => {
    const wanted = parseHotspotHash(window.location.hash);
    if (wanted === null) {
      applied.current = null;
      return;
    }
    if (applied.current === wanted) return;
    // Not loaded yet — this effect runs again when the next wave lands.
    if (!hotspots.some((hotspot) => hotspot.id === wanted)) return;

    applied.current = wanted;
    onSelect(wanted);
  }, [hotspots, onSelect]);

  useEffect(apply, [apply]);

  useEffect(() => {
    const handleHashChange = () => {
      applied.current = null;
      apply();
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [apply]);
}
