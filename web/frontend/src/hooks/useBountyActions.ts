/**
 * Writes to FireBounty: open a bounty, claim one, attest a claim.
 *
 * Every write follows the same beat — "Confirm in your wallet…", wait for the
 * receipt, refresh bounties — so the rail can never show a stale status.
 */

import { useCallback, useState } from 'react';
import type { TransactionReceipt, WalletClient } from 'viem';

import { chain, publicClient } from '../lib/chain';
import { BOUNTY } from '../lib/config';
import { bountyAbi } from '../lib/contracts';
import { errorMessage } from '../lib/errors';
import {
  claimVerifiedAbi,
  parseSettlementReceipt,
  readReceipts,
  saveReceipt,
  type ReceiptsByBounty,
} from '../lib/receipts';
import type { ShowToast } from './useToast';

interface Params {
  account: `0x${string}` | null;
  walletClient: WalletClient | null;
  show: ShowToast;
  onConfirmed: () => Promise<void> | void;
}

export interface BountyActions {
  openBounty: (hotspotId: number, ttlSeconds: number, amountWei: bigint) => Promise<void>;
  claim: (
    bountyId: number,
    evidence: string,
    latE6: number,
    lonE6: number,
    capturedAt: number,
    bondWei: bigint,
  ) => Promise<void>;
  attest: (claimId: number, approve: boolean, bountyId?: number) => Promise<void>;
  /** bountyId → the settlement this browser watched land, cached locally. */
  receipts: ReceiptsByBounty;
}

export function useBountyActions({ account, walletClient, show, onConfirmed }: Params): BountyActions {
  const [receipts, setReceipts] = useState<ReceiptsByBounty>(() => readReceipts());

  const run = useCallback(
    async (
      write: () => Promise<`0x${string}`>,
      onSettled?: (receipt: TransactionReceipt) => void,
    ): Promise<void> => {
      const dismiss = show('Confirm in your wallet…', true);
      try {
        const hash = await write();
        dismiss();

        const waiting = show(`Sent ${hash.slice(0, 10)}… waiting for settlement`, true);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        waiting();

        // The payout only exists in this receipt — the contract zeroes it in state.
        onSettled?.(receipt);

        show(`Settled · ${hash.slice(0, 10)}…`);
        await onConfirmed();
      } catch (error) {
        dismiss();
        show(errorMessage(error));
      }
    },
    [onConfirmed, show],
  );

  const openBounty = useCallback(
    async (hotspotId: number, ttlSeconds: number, amountWei: bigint): Promise<void> => {
      if (!walletClient || !account) return;
      await run(() =>
        walletClient.writeContract({
          address: BOUNTY,
          abi: bountyAbi,
          functionName: 'openBounty',
          args: [BigInt(hotspotId), ttlSeconds],
          value: amountWei,
          account,
          chain,
        }),
      );
    },
    [account, run, walletClient],
  );

  const claim = useCallback(
    async (
      bountyId: number,
      evidence: string,
      latE6: number,
      lonE6: number,
      capturedAt: number,
      bondWei: bigint,
    ): Promise<void> => {
      if (!walletClient || !account) return;
      await run(() =>
        walletClient.writeContract({
          address: BOUNTY,
          abi: bountyAbi,
          functionName: 'claim',
          args: [BigInt(bountyId), evidence, latE6, lonE6, capturedAt],
          value: bondWei,
          account,
          chain,
        }),
      );
    },
    [account, run, walletClient],
  );

  const attest = useCallback(
    async (claimId: number, approve: boolean, bountyId?: number): Promise<void> => {
      if (!walletClient || !account) return;
      await run(
        () =>
          walletClient.writeContract({
            address: BOUNTY,
            abi: bountyAbi,
            functionName: 'attest',
            args: [BigInt(claimId), approve],
            account,
            chain,
          }),
        (receipt) => {
          if (bountyId === undefined) return;
          const settlement = parseSettlementReceipt(receipt, claimVerifiedAbi);
          if (settlement) setReceipts(saveReceipt(bountyId, settlement));
        },
      );
    },
    [account, run, walletClient],
  );

  return { openBounty, claim, attest, receipts };
}
