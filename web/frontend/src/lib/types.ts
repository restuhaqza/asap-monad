/** Shapes shared by the data layer, the map and the rail. */

export interface Hotspot {
  id: number;
  /** Latitude in decimal degrees (latE6 / 1e6). */
  lat: number;
  /** Longitude in decimal degrees (lonE6 / 1e6). */
  lon: number;
  /** Latitude scaled by 1e6 — what `claim()` expects on-chain. */
  latE6: number;
  /** Longitude scaled by 1e6 — what `claim()` expects on-chain. */
  lonE6: number;
  /** Fire radiative power in MW (frpDeci / 10). */
  frp: number;
  /** Satellite acquisition time, unix seconds. */
  acqTime: number;
  confidence: number;
}

export interface Bounty {
  bountyId: number;
  hotspotId: number;
  backer: `0x${string}`;
  /** Escrow in wei. */
  pool: bigint;
  /** Deadline, unix seconds. */
  deadline: number;
  activeClaim: number;
  /** 0 no bounty · 1 open · 2 claimed · 3 verified · 4 expired. */
  status: number;
}
