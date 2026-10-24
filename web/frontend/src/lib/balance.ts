/**
 * Balance helpers. Pure, so the affordability rule can be tested without a
 * wallet: an unknown balance is not the same as an insufficient one.
 */

/** True when the wallet can cover `required`. Unknown balance never blocks. */
export function canAfford(balance: bigint | null, required: bigint): boolean {
  if (balance === null) return true;
  return balance >= required;
}

/** Short label for the header pill: `4.845 MON` or `—` while unread. */
export function formatBalance(balance: bigint | null, format: (wei: bigint) => string): string {
  return balance === null ? '—' : `${format(balance)} MON`;
}
