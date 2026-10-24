/** Injected wallet state: address, wallet client and verifier status. */

import { useCallback, useEffect, useState } from 'react';
import type { WalletClient } from 'viem';

import { createInjectedWallet, readBalance, readIsVerifier } from '../lib/chain';
import { ensureChain, getInjectedProvider, requestAccounts, silentAccounts } from '../lib/eip1193';

export interface WalletState {
  account: `0x${string}` | null;
  walletClient: WalletClient | null;
  /** Native MON balance, or null before the first successful read. */
  balance: bigint | null;
  isVerifier: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  /** Re-read the balance, e.g. after a transaction settles. */
  refreshBalance: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [isVerifier, setIsVerifier] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [connecting, setConnecting] = useState(false);

  /** Adopt an address the provider already gave us: state, client, roles, balance. */
  const adopt = useCallback(async (address: `0x${string}`, provider: NonNullable<ReturnType<typeof getInjectedProvider>>) => {
    setAccount(address);
    setWalletClient(createInjectedWallet(address, provider));
    const [verifierFlag, balanceValue] = await Promise.all([
      readIsVerifier(address).catch(() => false),
      readBalance(address).catch(() => null),
    ]);
    setIsVerifier(verifierFlag);
    if (balanceValue !== null) setBalance(balanceValue);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!account) return;
    const value = await readBalance(account).catch(() => null);
    if (value !== null) setBalance(value);
  }, [account]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const provider = getInjectedProvider();
      if (!provider) throw new Error('No injected wallet found — install MetaMask or Rabby');

      const address = await requestAccounts(provider);
      await ensureChain(provider);

      await adopt(address, provider);
    } finally {
      setConnecting(false);
    }
  }, []);

  // Silent reconnect: a wallet that already authorised this site hands the
  // address over without a prompt, so the balance is on screen at first paint.
  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;

    let alive = true;
    void silentAccounts(provider).then((address) => {
      if (!alive || !address) return;
      void adopt(address, provider);
    });

    return () => {
      alive = false;
    };
  }, [adopt]);

  // Follow the wallet when the user switches account or disconnects.
  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider?.on) return;

    const handler = (...args: unknown[]) => {
      const accounts = args[0];
      const next =
        Array.isArray(accounts) && typeof accounts[0] === 'string'
          ? (accounts[0] as `0x${string}`)
          : null;

      if (!next) {
        setAccount(null);
        setWalletClient(null);
        setIsVerifier(false);
        setBalance(null);
        return;
      }

      void adopt(next, provider);
    };

    provider.on('accountsChanged', handler);
    return () => provider.removeListener?.('accountsChanged', handler);
  }, []);

  // Keep the balance fresh while connected: a claim needs it, and it changes
  // every time the user funds or spends.
  useEffect(() => {
    if (!account) {
      setBalance(null);
      return;
    }
    void refreshBalance();
    const timer = setInterval(() => void refreshBalance(), 20_000);
    return () => clearInterval(timer);
  }, [account, refreshBalance]);

  return { account, walletClient, balance, isVerifier, connecting, connect, refreshBalance };
}
