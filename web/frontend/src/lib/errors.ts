/**
 * Human-readable messages out of viem / EIP-1193 errors.
 *
 * viem wraps RPC failures as `shortMessage` + `details` + `message`; injected
 * wallets throw plain objects with `code` and `message`. Nothing else in the app
 * needs to know that shape.
 */

interface Errorish {
  shortMessage?: unknown;
  details?: unknown;
  message?: unknown;
  status?: unknown;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error === null || error === undefined) return fallback;
  if (typeof error === 'string') return error.trim() || fallback;

  const candidate = error as Errorish;
  const parts = [candidate.shortMessage, candidate.details, candidate.message].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );

  const message = parts[0] ?? fallback;
  return typeof candidate.status === 'number' ? `${message} (${candidate.status})` : message;
}

/** EIP-1193 error code, or null when the error is not one. */
export function errorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}
