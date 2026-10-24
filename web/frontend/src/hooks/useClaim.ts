/**
 * `getClaim(claimId)` for the detail panel, read on demand.
 *
 * The receipt card needs the responder, the capture time, the evidence hash and
 * the approval count — all of that lives on the Claim struct, not on the Bounty.
 * A failed read leaves the card without facts rather than inventing them.
 */

import { useEffect, useState } from 'react';

import { readClaim } from '../lib/chain';
import type { Claim } from '../lib/types';

export function useClaim(claimId: number | null): Claim | null {
  const [claim, setClaim] = useState<Claim | null>(null);

  useEffect(() => {
    if (claimId === null) {
      setClaim(null);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setClaim(null);

    const attempt = (retriesLeft: number): void => {
      readClaim(claimId)
        .then((value) => {
          if (active) setClaim(value);
        })
        .catch(() => {
          if (!active) return;
          if (retriesLeft > 0) {
            timer = setTimeout(() => attempt(retriesLeft - 1), 700);
            return;
          }
          setClaim(null);
        });
    };

    attempt(1);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [claimId]);

  return claim;
}
