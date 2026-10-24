import { describe, expect, it } from 'vitest';

import {
  bountyFor,
  countExpired,
  countOpen,
  displayStatusLabel,
  hotspotPool,
  hotspotStatus,
  NO_BOUNTY,
  pickLargestPoolPerHotspot,
  sortByFrpDesc,
  STATUS_CLAIMED,
  STATUS_OPEN,
  STATUS_VERIFIED,
  statusColor,
  statusLabel,
  statusMap,
  totalEscrow,
} from './bounties';
import { STATUS_COLORS, STATUS_EXPIRED, STATUS_LABELS } from './config';
import type { Bounty, Hotspot } from './types';

const MON = 10n ** 18n;
const BACKER = '0x1111111111111111111111111111111111111111' as const;

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    bountyId: 1,
    hotspotId: 1,
    backer: BACKER,
    pool: 1n * MON,
    deadline: 1_792_821_900,
    activeClaim: 0,
    status: STATUS_OPEN,
    ...overrides,
  };
}

function hotspot(overrides: Partial<Hotspot> = {}): Hotspot {
  return {
    id: 1,
    lat: -2.1,
    lon: 113.5,
    latE6: -2_100_000,
    lonE6: 113_500_000,
    frp: 10,
    acqTime: 1_792_821_900,
    confidence: 80,
    ...overrides,
  };
}

describe('pickLargestPoolPerHotspot', () => {
  it('keeps the largest pool when one hotspot holds two bounties', () => {
    const small = bounty({ bountyId: 10, hotspotId: 5, pool: 1n * MON });
    const large = bounty({ bountyId: 11, hotspotId: 5, pool: 8n * MON });

    const byHotspot = pickLargestPoolPerHotspot([small, large]);

    expect(byHotspot.get(5)?.bountyId).toBe(11);
    expect(byHotspot.get(5)?.pool).toBe(8n * MON);
  });

  it('keeps the largest pool regardless of array order (newest does not win)', () => {
    const large = bounty({ bountyId: 11, hotspotId: 5, pool: 8n * MON });
    const newestButSmaller = bounty({ bountyId: 12, hotspotId: 5, pool: 2n * MON });

    // The newest bounty is last in the array, which would win a naive "last write" loop.
    const byHotspot = pickLargestPoolPerHotspot([large, newestButSmaller]);

    expect(byHotspot.get(5)?.bountyId).toBe(11);
  });

  it('keeps the first bounty when two pools are equal', () => {
    const byHotspot = pickLargestPoolPerHotspot([
      bounty({ bountyId: 1, hotspotId: 5, pool: 3n * MON }),
      bounty({ bountyId: 2, hotspotId: 5, pool: 3n * MON }),
    ]);

    // Equal pools: the first seen is kept (deterministic tie-break).
    expect(byHotspot.get(5)?.bountyId).toBe(1);
  });

  it('separates bounties that belong to different hotspots', () => {
    const byHotspot = pickLargestPoolPerHotspot([
      bounty({ bountyId: 1, hotspotId: 5, pool: 1n * MON }),
      bounty({ bountyId: 2, hotspotId: 6, pool: 2n * MON }),
      bounty({ bountyId: 3, hotspotId: 5, pool: 9n * MON }),
    ]);

    expect(byHotspot.size).toBe(2);
    expect(byHotspot.get(5)?.bountyId).toBe(3);
    expect(byHotspot.get(6)?.bountyId).toBe(2);
  });

  it('returns an empty map for no bounties', () => {
    expect(pickLargestPoolPerHotspot([]).size).toBe(0);
  });
});

describe('bountyFor / hotspotStatus / hotspotPool', () => {
  const byHotspot = pickLargestPoolPerHotspot([
    bounty({ bountyId: 11, hotspotId: 5, pool: 8n * MON, status: STATUS_CLAIMED }),
  ]);

  it('resolves the bounty shown for a hotspot', () => {
    expect(bountyFor(5, byHotspot)?.bountyId).toBe(11);
    expect(bountyFor(6, byHotspot)).toBeUndefined();
  });

  it('reports status 0 and pool 0n for a hotspot with no bounty', () => {
    expect(hotspotStatus(6, byHotspot)).toBe(NO_BOUNTY);
    expect(hotspotPool(6, byHotspot)).toBe(0n);
    expect(hotspotStatus(5, byHotspot)).toBe(STATUS_CLAIMED);
    expect(hotspotPool(5, byHotspot)).toBe(8n * MON);
  });
});

describe('statusMap', () => {
  it('maps hotspot ids to on-chain statuses', () => {
    const byHotspot = pickLargestPoolPerHotspot([
      bounty({ bountyId: 1, hotspotId: 5, status: STATUS_OPEN }),
      bounty({ bountyId: 2, hotspotId: 9, status: STATUS_EXPIRED }),
    ]);

    expect(statusMap(byHotspot)).toEqual({ 5: STATUS_OPEN, 9: STATUS_EXPIRED });
  });

  it('is empty when there are no bounties', () => {
    expect(statusMap(new Map())).toEqual({});
  });
});

describe('sortByFrpDesc', () => {
  it('sorts the biggest fire first', () => {
    const sorted = sortByFrpDesc([
      hotspot({ id: 1, frp: 5 }),
      hotspot({ id: 2, frp: 120 }),
      hotspot({ id: 3, frp: 42 }),
    ]);

    expect(sorted.map((h) => h.id)).toEqual([2, 3, 1]);
  });

  it('does not mutate the input array', () => {
    const input = [hotspot({ id: 1, frp: 5 }), hotspot({ id: 2, frp: 120 })];
    const sorted = sortByFrpDesc(input);

    expect(input.map((h) => h.id)).toEqual([1, 2]);
    expect(sorted).not.toBe(input);
  });
});

describe('countOpen', () => {
  it('counts only status 1', () => {
    expect(
      countOpen([
        bounty({ bountyId: 1, status: STATUS_OPEN }),
        bounty({ bountyId: 2, status: STATUS_OPEN }),
        bounty({ bountyId: 3, status: STATUS_CLAIMED }),
        bounty({ bountyId: 4, status: STATUS_VERIFIED }),
        bounty({ bountyId: 5, status: STATUS_EXPIRED }),
      ]),
    ).toBe(2);
  });

  it('is 0 for an empty list', () => {
    expect(countOpen([])).toBe(0);
  });
});

describe('countExpired', () => {
  it('is 0 for an empty list', () => {
    expect(countExpired([])).toBe(0);
  });

  it('is 0 when nothing has expired', () => {
    expect(
      countExpired([
        bounty({ bountyId: 1, status: STATUS_OPEN }),
        bounty({ bountyId: 2, status: STATUS_CLAIMED }),
        bounty({ bountyId: 3, status: STATUS_VERIFIED }),
      ]),
    ).toBe(0);
  });

  it('counts every expired bounty', () => {
    expect(
      countExpired([
        bounty({ bountyId: 1, status: STATUS_EXPIRED }),
        bounty({ bountyId: 2, status: STATUS_EXPIRED }),
        bounty({ bountyId: 3, status: STATUS_EXPIRED }),
      ]),
    ).toBe(3);
  });

  it('ignores the other statuses in a mixed list', () => {
    expect(
      countExpired([
        bounty({ bountyId: 1, status: STATUS_EXPIRED }),
        bounty({ bountyId: 2, status: STATUS_OPEN }),
        bounty({ bountyId: 3, status: STATUS_EXPIRED }),
        bounty({ bountyId: 4, status: STATUS_CLAIMED }),
        bounty({ bountyId: 5, status: STATUS_VERIFIED }),
      ]),
    ).toBe(2);
  });
});

describe('totalEscrow', () => {
  it('sums every pool as wei', () => {
    expect(
      totalEscrow([
        bounty({ bountyId: 1, pool: 1n * MON }),
        bounty({ bountyId: 2, pool: 2n * MON }),
        bounty({ bountyId: 3, pool: 500_000_000_000_000_000n }),
      ]),
    ).toBe(3_500_000_000_000_000_000n);
  });

  it('is 0n for an empty list', () => {
    expect(totalEscrow([])).toBe(0n);
  });
});

describe('statusLabel / displayStatusLabel', () => {
  it('uses the config labels for known statuses', () => {
    expect(statusLabel(NO_BOUNTY)).toBe(STATUS_LABELS[0]);
    expect(statusLabel(STATUS_OPEN)).toBe('Open');
    expect(statusLabel(STATUS_VERIFIED)).toBe('Verified');
  });

  it('falls back to the no-bounty label for unknown statuses', () => {
    expect(statusLabel(99)).toBe(STATUS_LABELS[0]);
    expect(displayStatusLabel(-1)).toBe('No bounty');
  });

  it('says "no responder" for an expired bounty', () => {
    expect(displayStatusLabel(STATUS_EXPIRED)).toBe('no responder');
    // The long-form label still exists for other contexts.
    expect(statusLabel(STATUS_EXPIRED)).toBe('Expired · no responder');
  });

  it('leaves the other statuses untouched', () => {
    expect(displayStatusLabel(STATUS_OPEN)).toBe('Open');
    expect(displayStatusLabel(STATUS_CLAIMED)).toBe('Claimed');
    expect(displayStatusLabel(STATUS_VERIFIED)).toBe('Verified');
  });
});

describe('statusColor', () => {
  it('maps each status to its palette entry', () => {
    expect(statusColor(NO_BOUNTY)).toBe(STATUS_COLORS[0]);
    expect(statusColor(STATUS_OPEN)).toBe(STATUS_COLORS[1]);
    expect(statusColor(STATUS_CLAIMED)).toBe(STATUS_COLORS[2]);
    expect(statusColor(STATUS_VERIFIED)).toBe(STATUS_COLORS[3]);
    expect(statusColor(STATUS_EXPIRED)).toBe(STATUS_COLORS[4]);
  });

  it('falls back to the no-bounty colour for an unknown status', () => {
    expect(statusColor(42)).toBe(STATUS_COLORS[0]);
  });
});
