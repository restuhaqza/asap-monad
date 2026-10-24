/**
 * viem clients + typed reads against HotspotRegistry and FireBounty.
 *
 * The public RPC allows 15 requests/second and caps `eth_getLogs` at 100 blocks,
 * and Multicall3 returned inconsistent results through it. So: no logs, no
 * multicall, one `eth_call` per id, paced by the caller (see hooks/useHotspots).
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem';

import { BOUNTY, CHAIN, REGISTRY, RPC_READ_URLS } from './config';
import { bountyAbi, registryAbi } from './contracts';
import type { InjectedProvider } from './eip1193';
import { fromE6 } from './geo';
import type { Bounty, Claim, Hotspot } from './types';

export const chain: Chain = CHAIN;

/**
 * One retry with a short, jittered backoff. Endpoints reject bursts, and a
 * single rejected read used to disappear quietly — a hotspot that never
 * painted, or a bond that never appeared.
 */
export async function resilient<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt + Math.random() * 200));
      }
    }
  }
  throw last;
}

/**
 * `retryCount: 0` on purpose: a 429 should fail over to the next endpoint
 * immediately instead of hammering the one that just refused us.
 */
export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: fallback(
    RPC_READ_URLS.map((url) => http(url, { retryCount: 0, timeout: 8_000 })),
    { rank: false },
  ),
});

/** Injected wallet client (`window.ethereum`). Created after the user connects. */
export function createInjectedWallet(
  account: `0x${string}`,
  provider: InjectedProvider,
): WalletClient {
  // `window.ethereum` is an EIP-1193 provider at runtime; the local interface
  // only loosens the listener signatures so it can stay framework-free.
  return createWalletClient({
    account,
    chain,
    transport: custom(provider as unknown as EIP1193Provider),
  });
}

/* ── pure mappers (unit-testable, no network) ───────────────────────────── */

type RawHotspot = {
  latE6: number;
  lonE6: number;
  frpDeci: number;
  acqTime: number;
  confidence: number;
  exists: boolean;
  batchId: `0x${string}`;
};

/** Registry struct → app shape. FRP is stored as tenths of a MW. */
export function mapHotspot(id: number, raw: RawHotspot): Hotspot {
  return {
    id,
    lat: fromE6(raw.latE6),
    lon: fromE6(raw.lonE6),
    latE6: raw.latE6,
    lonE6: raw.lonE6,
    frp: raw.frpDeci / 10,
    acqTime: raw.acqTime,
    confidence: raw.confidence,
  };
}

type RawBounty = {
  hotspotId: bigint;
  backer: `0x${string}`;
  pool: bigint;
  deadline: bigint;
  activeClaim: bigint;
  status: number;
};

/** Bounty struct → app shape, with the numeric fields narrowed. */
export function mapBounty(bountyId: number, raw: RawBounty): Bounty {
  return {
    bountyId,
    hotspotId: Number(raw.hotspotId),
    backer: raw.backer,
    pool: raw.pool,
    deadline: Number(raw.deadline),
    activeClaim: Number(raw.activeClaim),
    status: Number(raw.status),
  };
}

type RawClaim = {
  bountyId: bigint;
  responder: `0x${string}`;
  bond: bigint;
  latE6: number;
  lonE6: number;
  capturedAt: number;
  evidenceHash: `0x${string}`;
  approvals: number;
  rejections: number;
  settled: boolean;
};

/** Claim struct → app shape. `evidenceHash` stays bytes32; the CID is in the event. */
export function mapClaim(claimId: number, raw: RawClaim): Claim {
  return {
    claimId,
    bountyId: Number(raw.bountyId),
    responder: raw.responder,
    bond: raw.bond,
    latE6: raw.latE6,
    lonE6: raw.lonE6,
    capturedAt: Number(raw.capturedAt),
    evidenceHash: raw.evidenceHash,
    approvals: Number(raw.approvals),
    rejections: Number(raw.rejections),
    settled: raw.settled,
  };
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export async function readHotspotCount(): Promise<number> {
  const count = await resilient(() =>
    publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: 'hotspotCount',
    }),
  );
  return Number(count);
}

export async function readHotspot(id: number): Promise<Hotspot | null> {
  const raw = await resilient(() =>
    publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: 'getHotspot',
      args: [BigInt(id)],
    }),
  );
  if (!raw.exists) return null;
  return mapHotspot(id, raw);
}

export async function readBountyCount(): Promise<number> {
  const count = await resilient(() =>
    publicClient.readContract({
      address: BOUNTY,
      abi: bountyAbi,
      functionName: 'bountyCount',
    }),
  );
  return Number(count);
}

export async function readBounty(id: number): Promise<Bounty | null> {
  const raw = await resilient(() =>
    publicClient.readContract({
      address: BOUNTY,
      abi: bountyAbi,
      functionName: 'getBounty',
      args: [BigInt(id)],
    }),
  );
  // `pool === 0` means the id was never opened.
  if (raw.pool === 0n && raw.status === 0) return null;
  return mapBounty(id, raw);
}

export async function readClaim(claimId: number): Promise<Claim | null> {
  const raw = await resilient(() =>
    publicClient.readContract({
      address: BOUNTY,
      abi: bountyAbi,
      functionName: 'getClaim',
      args: [BigInt(claimId)],
    }),
  );
  // `bountyId === 0` means the claim id was never submitted.
  if (raw.bountyId === 0n) return null;
  return mapClaim(claimId, raw);
}

export async function readRequiredBond(bountyId: number): Promise<bigint> {
  return resilient(() =>
    publicClient.readContract({
      address: BOUNTY,
      abi: bountyAbi,
      functionName: 'requiredBond',
      args: [BigInt(bountyId)],
    }),
  );
}

/** Native MON balance for the connected account. */
export async function readBalance(address: `0x${string}`): Promise<bigint> {
  return resilient(() => publicClient.getBalance({ address }));
}

export async function readIsVerifier(who: `0x${string}`): Promise<boolean> {
  return resilient(() =>
    publicClient.readContract({
      address: BOUNTY,
      abi: bountyAbi,
      functionName: 'isVerifier',
      args: [who],
    }),
  );
}
