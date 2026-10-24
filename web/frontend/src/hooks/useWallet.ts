/** Injected wallet state: address, wallet client and verifier status. */

import { useCallback, useEffect, useState } from 'react';
import type { WalletClient } from 'viem';

import { createInjectedWallet, readIsVerifier } from '../lib/chain';
import { ensureChain, getInjectedProvider, requestAccounts } from '../lib/eip1193';

export interface WalletState {
  account: `0x${string}` | null;
  walletClient: WalletClient | null;
  isVerifier: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [isVerifier, setIsVerifier] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const provider = getInjectedProvider();
      if (!provider) throw new Error('No injected wallet found — install MetaMask or Rabby');

      const address = await requestAccounts(provider);
      await ensureChain(provider);

      setAccount(address);
      setWalletClient(createInjectedWallet(address, provider));
      setIsVerifier(await readIsVerifier(address).catch(() => false));
    } finally {
      setConnecting(false);
    }
  }, []);

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
        return;
      }

      setAccount(next);
      setWalletClient(createInjectedWallet(next, provider));
      void readIsVerifier(next)
        .then(setIsVerifier)
        .catch(() => setIsVerifier(false));
    };

    provider.on('accountsChanged', handler);
    return () => provider.removeListener?.('accountsChanged', handler);
  }, []);

  return { account, walletClient, isVerifier, connecting, connect };
}
