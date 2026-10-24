/**
 * Detail panel for the selected hotspot.
 *
 * Written for a person standing in a village, not for someone reading a block
 * explorer: the title is the nearest town, the first line says what this fire
 * means and what would answer it, and the raw chain facts sit underneath for
 * whoever wants them. `-2.1234, 113.5678` is still on screen — it is just no
 * longer the first thing you are told.
 */

import {
  displayStatusLabel,
  NO_BOUNTY,
  STATUS_CLAIMED,
  STATUS_OPEN,
  STATUS_VERIFIED,
  statusColor,
} from '../lib/bounties';
import { BOUNTY, CHAIN, EXPLORER, REGISTRY, STATUS_EXPIRED } from '../lib/config';
import { canAfford } from '../lib/balance';
import {
  confidenceLabel,
  formatCoords,
  formatFrp,
  formatMon,
  formatMonOrDash,
  formatTimeWIB,
  relativeTime,
  shortAddress,
} from '../lib/format';
import { formatPlaceTitle, nearestPlace } from '../lib/places';
import { useRequiredBond } from '../hooks/useRequiredBond';
import { useClaim } from '../hooks/useClaim';
import type { Bounty, Hotspot } from '../lib/types';
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
  /** How many loaded fires this one outranks, 0–100. Hidden when unknown. */
  hotterThanPct?: number | null;
  /** How many fires are loaded, for the "out of N" half of that sentence. */
  loadedCount?: number;
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

/** One sentence, in plain English, per lifecycle state. */
function ledeFor(status: number, pool: bigint, acqTime: number): string {
  const when = relativeTime(acqTime);
  switch (status) {
    case STATUS_OPEN:
      return `${formatMon(pool)} MON is waiting for the first responder who can prove they got there — a photo, a GPS fix, and a bond that comes back if a verifier approves it.`;
    case STATUS_CLAIMED:
      return 'Someone has filed proof. Two verifiers have to approve it before any money moves.';
    case STATUS_VERIFIED:
      return 'Answered. Someone proved they reached this spot, and the payout is already on-chain.';
    case NO_BOUNTY:
      return `A satellite picked this up ${when}. Nobody has put money behind it yet — opening a bounty is what makes one person responsible for answering it.`;
    default:
      return `Nobody answered this fire before the deadline. The backer was refunded, and it stays on the map as a fire nobody answered.`;
  }
}

export function DetailPanel({
  hotspot,
  bounty,
  isVerifier,
  account,
  balanceWei = null,
  receipt = null,
  hotterThanPct = null,
  loadedCount = 0,
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
  const place = nearestPlace(hotspot.lat, hotspot.lon);
  // A settled escrow holds zero by design, so the money cards must say what
  // happened to it instead of reporting "nobody has funded this fire yet".
  const paidOut = status === STATUS_VERIFIED;
  const refunded = status === STATUS_EXPIRED;
  const poolValue = paidOut ? 'paid out' : refunded ? 'refunded' : formatMonOrDash(pool);
  const poolNote = paidOut
    ? 'the responder was paid on-chain'
    : refunded
      ? 'returned to the backer'
      : pool > 0n
        ? 'paid to whoever proves it'
        : 'nobody has funded this fire yet';
  const bondValue = paidOut || refunded ? '—' : bounty && bondReady ? `${formatMon(bond)} MON` : '—';
  const bondNote = paidOut
    ? 'returned with the payout'
    : refunded
      ? 'no claim was ever filed'
      : 'back if approved · lost if false';
  const connectedHint = account ? null : (
    <div className="hint">Connect a wallet on {CHAIN.name} to fund, claim or attest.</div>
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
            Hotspot <span className="mono">#{hotspot.id}</span> · {place.province}
          </div>
          <h3>{formatPlaceTitle(place)}</h3>
          <div className="detail-coords mono">{formatCoords(hotspot.lat, hotspot.lon, 4)}</div>
        </div>
        <span className="pill" style={{ background: `${color}22`, color }} id="d-status">
          {displayStatusLabel(status)}
        </span>
      </div>

      <p className="detail-lede">{ledeFor(status, pool, hotspot.acqTime)}</p>

      <div className="facts">
        <div className="fact">
          <span>Heat</span>
          <b className="mono">{formatFrp(hotspot.frp)}</b>
          <em>
            {hotterThanPct === null
              ? 'satellite heat detection'
              : `stronger than ${hotterThanPct}% of the ${loadedCount} fires here`}
          </em>
        </div>
        <div className="fact">
          <span>Seen</span>
          <b>{relativeTime(hotspot.acqTime)}</b>
          <em>{formatTimeWIB(hotspot.acqTime)} WIB</em>
        </div>
      </div>

      <div className="kv">
        <div>
          <span>Bounty pool</span>
          <b className="mono">{poolValue}</b>
          <em>{poolNote}</em>
        </div>
        <div>
          <span>Bond required</span>
          <b className="mono">{bondValue}</b>
          <em>{bondNote}</em>
        </div>
      </div>

      <div className="detail-source">
        NASA FIRMS · VIIRS SNPP · {confidenceLabel(hotspot.confidence)}
      </div>

      {account ? (
        <div
          className={`balance-row${bounty && status === STATUS_OPEN && !canAfford(balanceWei, bond) ? ' warn' : ''}`}
        >
          <span>Your wallet</span>
          <b className="mono">{balanceWei === null ? '—' : `${formatMon(balanceWei)} MON`}</b>
          {bounty && status === STATUS_OPEN && !canAfford(balanceWei, bond) ? (
            <em>the bond needs {formatMon(bond)} MON</em>
          ) : null}
        </div>
      ) : null}

      <div id="controls">
        {!bounty && (
          <OpenBountyForm
            disabled={!account}
            onSubmit={(ttlSeconds, amountWei) => onOpenBounty(hotspot.id, ttlSeconds, amountWei)}
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
                  Two approvals pay the responder. Two rejections slash the bond and reopen the
                  bounty to everyone else.
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
          <ReceiptCard hotspot={hotspot} claim={claim} receipt={receipt} />
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
            · funded by {shortAddress(bounty.backer)} · deadline {formatTimeWIB(bounty.deadline)}
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
