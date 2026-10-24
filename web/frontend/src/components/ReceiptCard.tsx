/**
 * The payment receipt for a verified bounty.
 *
 * After settlement the contract zeroes the pool and the bond, so the amount only
 * exists in the `ClaimVerified` event. When this browser captured that event the
 * card states the exact payout; when the bounty was settled elsewhere or earlier,
 * it says so and shows only the facts that are still on-chain. Evidence, not
 * decoration — no confetti, no invented numbers.
 */

import { useState } from 'react';

import { EXPLORER } from '../lib/config';
import { formatMon, formatTimeWIB, shortAddress, shortHash } from '../lib/format';
import { distanceMeters, formatDistance } from '../lib/geo';
import type { SettlementReceipt } from '../lib/receipts';
import type { Claim, Hotspot } from '../lib/types';

interface ReceiptCardProps {
  hotspot: Hotspot;
  /** Null while the claim read is in flight, or when it failed. */
  claim: Claim | null;
  /** Null when this browser never saw the settlement transaction. */
  receipt: SettlementReceipt | null;
}

export function ReceiptCard({ hotspot, claim, receipt }: ReceiptCardProps) {
  const [copied, setCopied] = useState(false);

  const responder = receipt?.responder ?? claim?.responder ?? null;
  const distance =
    claim === null
      ? null
      : distanceMeters(hotspot.latE6, hotspot.lonE6, claim.latE6, claim.lonE6);

  const copyEvidence = (): void => {
    if (!claim) return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(claim.evidenceHash);
        setCopied(true);
      } catch {
        // Clipboard blocked (insecure context / permission): the hash is visible.
      }
    })();
  };

  return (
    <div className="receipt" id="d-receipt">
      <div className="receipt-head">
        <span className="receipt-eyebrow">Payment receipt</span>
        {receipt ? (
          <>
            <b className="mono">{formatMon(receipt.payout)} MON</b>
            <span>Paid to the responder in the settlement block.</span>
          </>
        ) : (
          <>
            <b>settled before this build</b>
            <span>
              The payout is not recoverable from contract state — the pool and bond are zeroed
              on settlement. The facts below are the parts that are still on-chain.
            </span>
          </>
        )}
      </div>

      <div className="kv">
        <div>
          <span>Responder</span>
          <b className="mono">
            {responder ? (
              <a
                href={`${EXPLORER}/address/${responder}`}
                target="_blank"
                rel="noreferrer"
                title={responder}
              >
                {shortAddress(responder)}
              </a>
            ) : (
              '—'
            )}
          </b>
        </div>
        <div>
          <span>Distance from hotspot</span>
          <b className="mono">{distance === null ? '—' : formatDistance(distance)}</b>
        </div>
        <div>
          <span>Evidence captured</span>
          <b className="mono">{claim ? formatTimeWIB(claim.capturedAt) : '—'}</b>
        </div>
        <div>
          <span>Approvals</span>
          <b className="mono">{claim ? `${claim.approvals} of 2` : '—'}</b>
        </div>
        <div>
          <span>Verifier reward</span>
          <b className="mono">{receipt ? `${formatMon(receipt.verifierReward)} MON` : '—'}</b>
        </div>
        <div>
          <span>Evidence hash</span>
          <b className="mono receipt-hash">
            {claim ? (
              <>
                {shortHash(claim.evidenceHash)}
                <button
                  type="button"
                  className="receipt-copy"
                  onClick={copyEvidence}
                  aria-label="Copy evidence hash"
                >
                  {copied ? 'copied' : 'copy'}
                </button>
              </>
            ) : (
              '—'
            )}
          </b>
        </div>
      </div>

      <div className="receipt-foot">
        {receipt ? (
          <a
            href={`${EXPLORER}/tx/${receipt.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mono"
          >
            payout tx {shortAddress(receipt.txHash)} · block {receipt.blockNumber}
          </a>
        ) : (
          <span>
            Payout amount unknown — nobody in this browser waited for the settlement receipt.
          </span>
        )}
      </div>
    </div>
  );
}
