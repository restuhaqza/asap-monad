import { describe, expect, it } from 'vitest';

import { canAfford, formatBalance } from './balance';
import { formatMon } from './format';

const MON = 10n ** 18n;

describe('canAfford', () => {
  it('never blocks on an unknown balance', () => {
    expect(canAfford(null, 5n * MON)).toBe(true);
  });

  it('allows an exact match and anything above it', () => {
    expect(canAfford(5n * MON, 5n * MON)).toBe(true);
    expect(canAfford(6n * MON, 5n * MON)).toBe(true);
  });

  it('blocks when the wallet is short', () => {
    expect(canAfford(4n * MON, 5n * MON)).toBe(false);
    expect(canAfford(0n, 1n)).toBe(false);
  });

  it('treats a zero requirement as affordable', () => {
    expect(canAfford(0n, 0n)).toBe(true);
  });
});

describe('formatBalance', () => {
  it('labels an unread balance instead of pretending it is zero', () => {
    expect(formatBalance(null, formatMon)).toBe('—');
  });

  it('formats wei as MON with three decimals', () => {
    expect(formatBalance(4_845_033_325_860_000_000n, formatMon)).toBe('4.845 MON');
  });
});
