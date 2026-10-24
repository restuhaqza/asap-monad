/** Detail panel for the selected hotspot: on-chain facts + the one available action. */

import {
  displayStatusLabel,
  NO_BOUNTY,
  STATUS_CLAIMED,
  STATUS_OPEN,
  STATUS_VERIFIED,
  statusColor,
} from '../lib/bounties';
import { BOUNTY, EXPLORER, REGISTRY } from '../lib/config';
import { canAfford } from '../lib/balance';
import { formatCoords, formatFrp, formatMon, formatMonOrDash, formatTimeWIB, shortAddress } from '../lib/format';
import { useRequiredBond } from '../hooks/useRequiredBond';
import { useClaim } from '../hooks/useClaim';import type { Bounty, Hotspot } from '../lib/types';
import type { SettlementReceipt } from '../lib/receipts';
import { EvidencePicker } from './EvidencePicker';
import { OpenBountyForm } from './OpenBountyForm';
import { ReceiptCard } from './ReceiptCard';

interface DetailPanelProps {
  hotspot: Hotspot;
  bounty: Bounty | null;
  isVerifier: boolean;
  account: `0x${string}` | null;
  /** Wallet balance in wei, null until read. */
  balanceWei?: bigint | null;
  /** Cached settlement for this bounty, when this browser saw the payout land. */
  receipt?: SettlementReceipt | null;
  onOpenBounty: (hotspotId: number, ttlSeconds: number, amountWei: bigint) => void;
  onClaim: (
    bountyId: number,
    evidence: string,
    latE6: number,
    lonE6: number,
    capturedAt: number,
    bondWei: bigint,
  ) => void;
  onAttest: (claimId: number, approve: boolean) => void;
  /** Mobile only: dismisses the bottom sheet. Hidden on desktop by CSS. */
  onClose?: () => void;
}

export function DetailPanel({
  hotspot,
  bounty,
  isVerifier,
  account,
  balanceWei = null,
  receipt = null,
  onOpenBounty,
  onClaim,
  onAttest,
  onClose,
}: DetailPanelProps) {
  const status = bounty?.status ?? NO_BOUNTY;
  const color = statusColor(status);
  const { bond, ready: bondReady } = useRequiredBond(bounty?.bountyId ?? null);
  const claim = useClaim(bounty && status === STATUS_VERIFIED ? bounty.activeClaim : null);
  const pool = bounty?.pool ?? 0n;
  const connectedHint = account ? null : (
    <div className="hint">Connect a wallet on Monad Testnet to fund, claim or attest.</div>
  );

  return (
    <div className="detail" id="detail">
      {onClose ? (
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      ) : null}

      <div className="detail-head">
        <div>
          <div className="muted detail-eyebrow">
            Hotspot <span className="mono">#{hotspot.id}</span>
          </div>
          <h3 className="mono">{formatCoords(hotspot.lat, hotspot.lon, 4)}</h3>
        </div>
        <span className="pill" style={{ background: `${color}22`, color }} id="d-status">
          {displayStatusLabel(status)}
        </span>
      </div>

      <div className="kv">
        <div>
          <span>Fire radiative power</span>
          <b className="mono">{formatFrp(hotspot.frp)}</b>
        </div>
        <div>
          <span>Detected</span>
          <b className="mono">{formatTimeWIB(hotspot.acqTime)}</b>
        </div>
        <div>
          <span>Bounty pool</span>
          <b className="mono">{formatMonOrDash(pool)}</b>
        </div>
        <div>
          <span>Bond required</span>
          <b className="mono">{bounty && bondReady ? `${formatMon(bond)} MON` : '—'}</b>
        </div>
      </div>

      {account ? (
        <div className={`balance-row${bounty && status === STATUS_OPEN && !canAfford(balanceWei, bond) ? ' warn' : ''}`}>
          <span>Wallet balance</span>
          <b className="mono">{balanceWei === null ? '—' : `${formatMon(balanceWei)} MON`}</b>
          {bounty && status === STATUS_OPEN && !canAfford(balanceWei, bond) ? (
            <em>bond needs {formatMon(bond)} MON</em>
          ) : null}
        </div>
      ) : null}

      <div id="controls">
        {!bounty && (
          <OpenBountyForm
            disabled={!account}
            onSubmit={(ttlSeconds, amountWei) =>
              onOpenBounty(hotspot.id, ttlSeconds, amountWei)
            }
          />
        )}

        {bounty && status === STATUS_OPEN && (
          <EvidencePicker
            key={`${hotspot.id}:${bounty.bountyId}`}
            bondWei={bond}
            bondReady={bondReady}
            balanceWei={balanceWei}
            disabled={!account}
            onClaim={(evidence) =>
              onClaim(
                bounty.bountyId,
                evidence,
                hotspot.latE6,
                hotspot.lonE6,
                Math.floor(Date.now() / 1000),
                bond,
              )
            }
          />
        )}

        {bounty && status === STATUS_CLAIMED && (
          <>
            {isVerifier ? (
              <>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onAttest(bounty.activeClaim, true)}
                  >
                    Approve · attest({bounty.activeClaim}, true)
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--dead)', borderColor: 'rgba(255,92,92,.35)' }}
                    onClick={() => onAttest(bounty.activeClaim, false)}
                  >
                    Reject
                  </button>
                </div>
                <div className="hint">
                  Two approvals settle the claim and pay the responder. Two rejections slash the bond
                  and reopen the bounty.
                </div>
              </>
            ) : (
              <div className="hint">
                Claim #{bounty.activeClaim} is awaiting verifier quorum. Connect a verifier wallet to
                attest.
              </div>
            )}
          </>
        )}

        {bounty && status === STATUS_VERIFIED && (
          <>
            <div className="hint">Claim verified. The responder has been paid on-chain.</div>
            <ReceiptCard hotspot={hotspot} claim={claim} receipt={receipt} />
          </>
        )}

        {bounty && status !== STATUS_OPEN && status !== STATUS_CLAIMED && status !== STATUS_VERIFIED && (
          <div className="hint">
            Bounty expired — the backer was refunded, and the row stays public as a fire nobody
            answered.
          </div>
        )}

        {connectedHint}
      </div>

      <div className="trail" id="d-trail">
        {bounty ? (
          <>
            Bounty{' '}
            <a href={`${EXPLORER}/address/${BOUNTY}`} target="_blank" rel="noreferrer">
              #{bounty.bountyId}
            </a>{' '}
            · backer {shortAddress(bounty.backer)} · deadline {formatTimeWIB(bounty.deadline)}
          </>
        ) : (
          <>
            Hotspot record{' '}
            <a href={`${EXPLORER}/address/${REGISTRY}`} target="_blank" rel="noreferrer">
              #{hotspot.id}
            </a>{' '}
            · anchored to the FIRMS source file hash
          </>
        )}
      </div>
    </div>
  );
}
