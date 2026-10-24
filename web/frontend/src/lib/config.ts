/**
 * Chain, deployment and UI config.
 *
 * The app ships twice from one source tree: a testnet build at
 * `testnet.asapmonad.web.id` and a mainnet build at `asapmonad.web.id`. The
 * difference is baked in at build time (`.env.testnet` / `.env.mainnet`) so the
 * bundle stays static and reproducible — no runtime chain switching, no chance
 * of a mainnet page reading a testnet address because a query string said so.
 */

export type NetworkKey = 'testnet' | 'mainnet';

const REQUESTED = import.meta.env.VITE_NETWORK;
export const NETWORK: NetworkKey = REQUESTED === 'mainnet' ? 'mainnet' : 'testnet';
export const IS_MAINNET = NETWORK === 'mainnet';

const TESTNET_CHAIN = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' } },
} as const;

const MAINNET_CHAIN = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://monadscan.com' } },
} as const;

export const CHAIN = IS_MAINNET ? MAINNET_CHAIN : TESTNET_CHAIN;
export const RPC_URL = CHAIN.rpcUrls.default.http[0];

/**
 * Read-only fallbacks. On testnet both answer chain 10143 and return
 * byte-identical results for `getHotspot`; the primary RPC rejects bursts with
 * 429, and a demo cannot afford an empty map because one endpoint got moody.
 * Mainnet has no measured fallback yet, so it uses the official node alone.
 */
export const RPC_FALLBACKS = IS_MAINNET
  ? []
  : ['https://monad-testnet.drpc.org', 'https://rpc.ankr.com/monad_testnet'];

/**
 * Order matters and was measured, not guessed: in 20 concurrent calls the
 * official endpoint returned 10x 429, drpc 5x 400, and ankr 20x 200. Reads go
 * to ankr first, keep the official node as the trusted second opinion, and use
 * drpc only as a last resort.
 */
export const RPC_READ_URLS = IS_MAINNET
  ? [RPC_URL]
  : ['https://rpc.ankr.com/monad_testnet', RPC_URL, ...RPC_FALLBACKS];
export const EXPLORER = CHAIN.blockExplorers.default.url;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** A build with a malformed or missing address must not silently ship. */
function address(value: string | undefined, fallback: string): `0x${string}` {
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as `0x${string}`;
  return fallback as `0x${string}`;
}

/** HotspotRegistry — testnet deployed 24 Oct 2026. */
export const REGISTRY = IS_MAINNET
  ? address(import.meta.env.VITE_REGISTRY, ZERO_ADDRESS)
  : '0xe691172812761cd8c1efcdbeb89192b35cacb9e7';

/** FireBounty — testnet deployed 24 Oct 2026. */
export const BOUNTY = IS_MAINNET
  ? address(import.meta.env.VITE_BOUNTY, ZERO_ADDRESS)
  : '0x6ec281aac8f6bec24ba84c56800879b66c13097a';

/** False on a mainnet build whose addresses were never filled in. */
export const CONTRACTS_DEPLOYED = REGISTRY !== ZERO_ADDRESS && BOUNTY !== ZERO_ADDRESS;

/** On-chain Status enum mapped to the UI. Index === enum value. */
export const STATUS_COLORS = ['#5b5473', '#f5a524', '#5b9dff', '#3dd68c', '#ff5c5c'] as const;
export const STATUS_LABELS = [
  'No bounty',
  'Open',
  'Claimed',
  'Verified',
  'Expired · no responder',
] as const;
export const STATUS_EXPIRED = 4;

/**
 * How many hotspots we paint. Ids are ordered by FRP at publish time, so the
 * first N are the biggest fires.
 */
export const MAX_SHOWN = 80;

/** Reads are paced: the public RPC allows 15 req/s and has no usable getLogs. */
export const HOTSPOT_WAVE_SIZE = 5;
export const HOTSPOT_WAVE_DELAY_MS = 600;
export const HOTSPOT_RETRY_WAVE_SIZE = 4;
export const HOTSPOT_RETRY_DELAY_MS = 900;
export const BOUNTY_WAVE_SIZE = 6;
export const BOUNTY_WAVE_DELAY_MS = 700;

/** localStorage cache of the hotspot rows, keyed by on-chain count. */
export const CACHE_KEY = 'asap.hotspots.v1';
export const CACHE_TTL_MS = 15 * 60 * 1000;

/** Map defaults (Indonesia, whole archipelago). */
export const MAP_CENTER: [number, number] = [-2.2, 113.5];
export const MAP_ZOOM = 5;
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 14;
export const TILES_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
export const TILES_REFERENCE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
/**
 * The label layer joins at zoom 6. At the national view its city names render
 * bigger than our own headings, so they are withheld until the map is close
 * enough for them to read as a backdrop.
 */
export const LABEL_MIN_ZOOM = 6;

export const TILES_ATTRIBUTION = 'Tiles © Esri · hotspots © NASA FIRMS';
