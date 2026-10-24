// Chain + deployment config. Values are the ones recorded in ../README.md.

export const CHAIN = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' } },
  // canonical Multicall3 — lets the app read 180 hotspots with a single eth_call
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
};

export const REGISTRY = '0xe691172812761cd8c1efcdbeb89192b35cacb9e7';
export const BOUNTY = '0x6ec281aac8f6bec24ba84c56800879b66c13097a';

// First block we ever wrote to, minus a safety margin. Log scans start here.
export const FROM_BLOCK = 73_700_000n;

export const EXPLORER = 'https://testnet.monadscan.com';

// UI mapping for the on-chain Status enum.
export const STATUS = {
  0: { label: 'No bounty', color: '#5b5473' },
  1: { label: 'Open', color: '#f5a524' },
  2: { label: 'Claimed', color: '#5b9dff' },
  3: { label: 'Verified', color: '#3dd68c' },
  4: { label: 'Expired · no responder', color: '#ff5c5c' },
};
