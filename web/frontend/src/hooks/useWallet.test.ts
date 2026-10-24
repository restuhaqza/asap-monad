import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = '0x65F3153e922f2a245e376dF2A75d3088F6675179';
const BALANCE = 4_845_033_325_860_000_000n;

const { provider, silentAccountsMock, requestAccountsMock, readBalanceMock, readIsVerifierMock } =
  vi.hoisted(() => ({
    provider: { request: vi.fn() },
    silentAccountsMock: vi.fn(),
    requestAccountsMock: vi.fn(),
    readBalanceMock: vi.fn(),
    readIsVerifierMock: vi.fn(),
  }));

vi.mock('../lib/eip1193', () => ({
  getInjectedProvider: () => provider,
  silentAccounts: silentAccountsMock,
  requestAccounts: requestAccountsMock,
  ensureChain: vi.fn(),
}));

vi.mock('../lib/chain', () => ({
  createInjectedWallet: () => ({ writeContract: vi.fn() }),
  readBalance: readBalanceMock,
  readIsVerifier: readIsVerifierMock,
}));

import { useWallet } from './useWallet';

beforeEach(() => {
  vi.clearAllMocks();
  readBalanceMock.mockResolvedValue(BALANCE);
  readIsVerifierMock.mockResolvedValue(false);
});

describe('useWallet — silent reconnect', () => {
  it('adopts an already-authorised wallet and shows its balance without a prompt', async () => {
    silentAccountsMock.mockResolvedValue(ADDRESS);

    const { result, unmount } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.account).toBe(ADDRESS));
    await waitFor(() => expect(result.current.balance).toBe(BALANCE));
    expect(result.current.walletClient).not.toBeNull();

    // The whole point: no popup, so `eth_requestAccounts` was never called.
    expect(requestAccountsMock).not.toHaveBeenCalled();
    unmount();
  });

  it('stays disconnected when the site has no authorisation', async () => {
    silentAccountsMock.mockResolvedValue(null);

    const { result, unmount } = renderHook(() => useWallet());

    await waitFor(() => expect(silentAccountsMock).toHaveBeenCalled());
    expect(result.current.account).toBeNull();
    expect(result.current.balance).toBeNull();
    expect(requestAccountsMock).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps working when the balance read fails, without inventing a zero', async () => {
    silentAccountsMock.mockResolvedValue(ADDRESS);
    readBalanceMock.mockRejectedValue(new Error('rpc down'));

    const { result, unmount } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.account).toBe(ADDRESS));
    expect(result.current.balance).toBeNull();
    unmount();
  });
});
