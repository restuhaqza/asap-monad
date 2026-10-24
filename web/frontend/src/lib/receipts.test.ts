import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BOUNTY } from './config';
import {
  claimVerifiedAbi,
  parseSettlementReceipt,
  readReceipts,
  RECEIPTS_KEY,
  saveReceipt,
  type SettlementReceipt,
} from './receipts';

const RESPONDER = '0xbe500dd19a075af040279612be845563a8a81b73' as const;
const TX = `0x${'ab'.repeat(32)}` as const;

/** One `ClaimVerified(1, responder, 1.9 MON, 0.1 MON)` log, shaped like viem's. */
function claimVerifiedLog(
  claimId = 1n,
  payout = 1_900_000_000_000_000_000n,
  verifierReward = 100_000_000_000_000_000n,
): TransactionReceipt['logs'][number] {
  const topics = encodeEventTopics({
    abi: claimVerifiedAbi,
    eventName: 'ClaimVerified',
    args: { claimId, responder: RESPONDER },
  });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [payout, verifierReward],
  );

  return {
    address: BOUNTY,
    topics,
    data,
    blockHash: `0x${'11'.repeat(32)}`,
    blockNumber: 16_000_000n,
    logIndex: 3,
    transactionHash: TX,
    transactionIndex: 0,
    removed: false,
  } as unknown as TransactionReceipt['logs'][number];
}

function receiptWith(
  logs: TransactionReceipt['logs'],
): Pick<TransactionReceipt, 'logs' | 'transactionHash' | 'blockNumber'> {
  return { logs, transactionHash: TX, blockNumber: 16_000_000n };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('parseSettlementReceipt', () => {
  it('reads the payout and verifier reward out of a ClaimVerified log', () => {
    const parsed = parseSettlementReceipt(receiptWith([claimVerifiedLog()]));

    expect(parsed).not.toBeNull();
    expect(parsed?.responder.toLowerCase()).toBe(RESPONDER.toLowerCase());
    expect(parsed?.payout).toBe(1_900_000_000_000_000_000n);
    expect(parsed?.verifierReward).toBe(100_000_000_000_000_000n);
    expect(parsed?.txHash).toBe(TX);
    expect(parsed?.blockNumber).toBe(16_000_000);
  });

  it('returns null when the transaction settled nothing', () => {
    expect(parseSettlementReceipt(receiptWith([]))).toBeNull();
  });

  it('ignores other events in the same receipt', () => {
    const other = {
      ...claimVerifiedLog(),
      topics: [`0x${'00'.repeat(32)}`],
      data: '0x' as const,
    } as unknown as TransactionReceipt['logs'][number];

    const parsed = parseSettlementReceipt(receiptWith([other, claimVerifiedLog(2n)]));

    expect(parsed?.payout).toBe(1_900_000_000_000_000_000n);
  });
});

describe('receipt cache', () => {
  const receipt: SettlementReceipt = {
    responder: RESPONDER,
    payout: 2n * 10n ** 18n,
    verifierReward: 10n ** 17n,
    txHash: TX,
    blockNumber: 16_000_123,
  };

  it('is empty on a fresh browser', () => {
    expect(readReceipts()).toEqual({});
  });

  it('round-trips a receipt through localStorage with bigints intact', () => {
    saveReceipt(7, receipt);

    const read = readReceipts();
    expect(read[7]?.payout).toBe(2n * 10n ** 18n);
    expect(read[7]?.verifierReward).toBe(10n ** 17n);
    expect(read[7]?.responder).toBe(RESPONDER);
    expect(read[7]?.txHash).toBe(TX);
  });

  it('merges instead of replacing, so two bounties keep their receipts', () => {
    saveReceipt(7, receipt);
    saveReceipt(9, { ...receipt, payout: 5n * 10n ** 18n });

    const read = readReceipts();
    expect(Object.keys(read).sort()).toEqual(['7', '9']);
    expect(read[9]?.payout).toBe(5n * 10n ** 18n);
  });

  it('survives a corrupt cache instead of throwing', () => {
    localStorage.setItem(RECEIPTS_KEY, '{not json');

    expect(readReceipts()).toEqual({});
  });

  it('skips entries that cannot be trusted', () => {
    localStorage.setItem(
      RECEIPTS_KEY,
      JSON.stringify({ 7: { responder: RESPONDER, payout: 'oops', verifierReward: '0' } }),
    );

    expect(readReceipts()).toEqual({});
  });
});
