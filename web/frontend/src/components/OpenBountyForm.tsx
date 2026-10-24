/** Fund a hotspot that has no bounty yet: amount in MON + time-to-live in hours. */

import { useState } from 'react';

import { formatMon, parseHoursInput, parseMonInput } from '../lib/format';

interface OpenBountyFormProps {
  disabled: boolean;
  onSubmit: (ttlSeconds: number, amountWei: bigint) => void;
}

export function OpenBountyForm({ disabled, onSubmit }: OpenBountyFormProps) {
  const [amount, setAmount] = useState('0.05');
  const [ttlHours, setTtlHours] = useState('6');

  const amountWei = parseMonInput(amount);
  const ttlSeconds = parseHoursInput(ttlHours);
  const canOpen = Boolean(amountWei && ttlSeconds) && !disabled;

  return (
    <div>
      <div className="field">
        <input
          value={amount}
          placeholder="MON"
          aria-label="Bounty amount in MON"
          onChange={(event) => setAmount(event.target.value)}
        />
        <input
          value={ttlHours}
          placeholder="hours"
          aria-label="Bounty time to live in hours"
          style={{ maxWidth: 90 }}
          onChange={(event) => setTtlHours(event.target.value)}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canOpen}
          onClick={() => {
            if (amountWei !== null && ttlSeconds !== null) onSubmit(ttlSeconds, amountWei);
          }}
        >
          {amountWei !== null ? `Open bounty · ${formatMon(amountWei)} MON` : 'Open bounty'}
        </button>
      </div>

      <div className="hint">
        Whoever carries the risk funds the escrow: a concession, a carbon project, a CSR budget, or
        BPBD.
      </div>
    </div>
  );
}
