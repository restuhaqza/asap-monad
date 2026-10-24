/**
 * Settlement receipts, keyed by bounty id.
 *
 * `_settleApproved` zeroes `b.pool` and `c.bond` before it transfers, so the paid
 * amount is not recoverable from state afterwards — it only ever exists in the
 * `ClaimVerified` event. So the app parses that event out of the attest receipt
 * at the moment it fires and caches the result locally. A bounty settled before
 * this build has no cached payout, and the UI says so instead of inventing one.
 *
 * Only the logs of a single receipt we just waited for are ever parsed. No
 * `eth_getLogs`: the public RPC caps it at 100 blocks.
 */

import { parseAbi, parseEventLogs, type Abi, type TransactionReceipt } from 'viem';

export const RECEIPTS_KEY = 'asap.receipts.v1';

/** The one event that carries the money. Mirrors `contracts/src/FireBounty.sol`. */
export const claimVerifiedAbi = parseAbi([
  'event ClaimVerified(uint256 indexed claimId, address indexed responder, uint256 payout, uint256 verifierReward)',
]);

export interface SettlementReceipt {
  responder: `0x${string}`;
  /** Paid to the responder, in wei. */
  payout: bigint;
  /** Split equally between the approvers, in wei. */
  verifierReward: bigint;
  txHash: `0x${string}`;
  blockNumber: number;
}

/** bountyId → the settlement that paid it. */
export type ReceiptsByBounty = Record<number, SettlementReceipt>;

/** What actually goes to disk: bigint does not survive JSON. */
interface StoredReceipt {
  responder: string;
  payout: string;
  verifierReward: string;
  txHash: string;
  blockNumber: number;
}

type ReceiptLike = Pick<TransactionReceipt, 'logs' | 'transactionHash' | 'blockNumber'>;

/**
 * The payout emitted by a settlement transaction, or null when this receipt did
 * not settle anything (the second reject vote, a plain fund, a revert-free
 * non-quorum attestation).
 */
export function parseSettlementReceipt(
  receipt: ReceiptLike,
  abi: Abi = claimVerifiedAbi,
): SettlementReceipt | null {
  try {
    const [found] = parseEventLogs({ abi, logs: receipt.logs, eventName: 'ClaimVerified' });
    if (!found) return null;

    const { responder, payout, verifierReward } = found.args as {
      responder: `0x${string}`;
      payout: bigint;
      verifierReward: bigint;
    };
    if (!responder || typeof payout !== 'bigint') return null;

    return {
      responder,
      payout,
      verifierReward,
      txHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber ?? 0),
    };
  } catch {
    return null;
  }
}

/** Everything cached so far. Empty on a fresh browser or blocked storage. */
export function readReceipts(): ReceiptsByBounty {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(RECEIPTS_KEY) ?? null;
  } catch {
    return {};
  }
  if (!raw) return {};

  try {
    const stored = JSON.parse(raw) as Record<string, StoredReceipt>;
    const out: ReceiptsByBounty = {};
    for (const [key, value] of Object.entries(stored)) {
      const bountyId = Number(key);
      if (!Number.isInteger(bountyId) || !value) continue;
      const payout = BigInt(value.payout);
      const verifierReward = BigInt(value.verifierReward);
      if (!value.responder || !value.txHash) continue;
      out[bountyId] = {
        responder: value.responder as `0x${string}`,
        payout,
        verifierReward,
        txHash: value.txHash as `0x${string}`,
        blockNumber: Number(value.blockNumber ?? 0),
      };
    }
    return out;
  } catch {
    // Corrupt cache is not worth a broken panel: fall back to empty.
    return {};
  }
}

/**
 * Merge one receipt into the cache and return the new map, so the caller can
 * put it straight into React state. Storage failures are swallowed — a private
 * mode browser still shows the receipt for this session.
 */
export function saveReceipt(bountyId: number, receipt: SettlementReceipt): ReceiptsByBounty {
  const merged: ReceiptsByBounty = { ...readReceipts(), [bountyId]: receipt };
  try {
    const stored: Record<string, StoredReceipt> = {};
    for (const [key, value] of Object.entries(merged)) {
      stored[key] = {
        responder: value.responder,
        payout: value.payout.toString(),
        verifierReward: value.verifierReward.toString(),
        txHash: value.txHash,
        blockNumber: value.blockNumber,
      };
    }
    globalThis.localStorage?.setItem(RECEIPTS_KEY, JSON.stringify(stored));
  } catch {
    /* private mode / quota — the in-memory copy is enough */
  }
  return merged;
}
