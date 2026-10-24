/**
 * `requiredBond(bountyId)` for the detail panel, read on demand.
 *
 * A failed read is not the same thing as a zero bond. The public RPC rejects
 * bursts above ~15 requests/second, and the panel used to swallow that error into
 * `0n` — the UI then showed "bond 0.000 MON" and let a claim through with the
 * wrong `msg.value`, which reverts on-chain. So the hook reports readiness
 * separately, retries once, and the caller must keep the claim button disabled
 * until `ready` is true.
 */

import { useEffect, useState } from 'react';

import { readRequiredBond } from '../lib/chain';

export interface RequiredBond {
  /** Wei required as a bond. Only meaningful when `ready` is true. */
  bond: bigint;
  /** True only after a successful read for the current bounty. */
  ready: boolean;
}

const NOT_READY: RequiredBond = { bond: 0n, ready: false };

export function useRequiredBond(bountyId: number | null): RequiredBond {
  const [state, setState] = useState<RequiredBond>(NOT_READY);

  useEffect(() => {
    if (bountyId === null) {
      setState(NOT_READY);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(NOT_READY);

    const attempt = (retriesLeft: number): void => {
      readRequiredBond(bountyId)
        .then((value) => {
          if (active) setState({ bond: value, ready: true });
        })
        .catch(() => {
          if (!active) return;
          if (retriesLeft > 0) {
            timer = setTimeout(() => attempt(retriesLeft - 1), 700);
            return;
          }
          setState(NOT_READY);
        });
    };

    attempt(1);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [bountyId]);

  return state;
}
