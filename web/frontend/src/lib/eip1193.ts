/**
 * Injected wallet (EIP-1193) helpers: `window.ethereum`, chain switching and the
 * 4902 fallback that adds Monad Testnet to a wallet that has never seen it.
 */

import { CHAIN } from './config';
import { errorCode } from './errors';

export interface InjectedProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

/** `window.ethereum`, or null when the user has no wallet extension. */
export function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === 'undefined') return null;
  const ethereum = (window as Window & { ethereum?: InjectedProvider }).ethereum;
  return ethereum ?? null;
}

export const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}`;

/** Chain definition in the shape `wallet_addEthereumChain` expects. */
export function addChainParams() {
  return {
    chainId: CHAIN_ID_HEX,
    chainName: CHAIN.name,
    nativeCurrency: CHAIN.nativeCurrency,
    rpcUrls: [...CHAIN.rpcUrls.default.http],
    blockExplorerUrls: [CHAIN.blockExplorers.default.url],
  };
}

/**
 * Switch the wallet to Monad Testnet, adding the chain when the wallet answers
 * with 4902 (unknown chain). Any other error is rethrown so the caller can toast.
 */
export async function ensureChain(provider: InjectedProvider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    if (errorCode(error) !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [addChainParams()],
    });
  }
}

/** First address from `eth_requestAccounts`. Throws when the user rejects. */
export async function requestAccounts(provider: InjectedProvider): Promise<`0x${string}`> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address !== 'string' || !address.startsWith('0x')) {
    throw new Error('Wallet returned no account');
  }
  return address as `0x${string}`;
}
