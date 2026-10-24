/**
 * Chain, deployment and UI config. Values mirror the live build in
 * `web/frontend` (canonical host: https://asapmonad.web.id); nothing here reads
 * from the environment so the static Worker bundle stays reproducible.
 */

export const CHAIN = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' } },
} as const;

export const RPC_URL = CHAIN.rpcUrls.default.http[0];

/**
 * Read-only fallbacks. Both answer chain 10143 and return byte-identical results
 * for `getHotspot`; the primary RPC rejects bursts with 429, and a demo cannot
 * afford an empty map because one endpoint got moody.
 */
export const RPC_FALLBACKS = [
  'https://monad-testnet.drpc.org',
  'https://rpc.ankr.com/monad_testnet',
];

/**
 * Order matters and was measured, not guessed: in 20 concurrent calls the
 * official endpoint returned 10x 429, drpc 5x 400, and ankr 20x 200. Reads go
 * to ankr first, keep the official node as the trusted second opinion, and use
 * drpc only as a last resort.
 */
export const RPC_READ_URLS = [
  'https://rpc.ankr.com/monad_testnet',
  RPC_URL,
  ...RPC_FALLBACKS,
];
export const EXPLORER = CHAIN.blockExplorers.default.url;

/** HotspotRegistry — deployed 24 Oct 2026. */
export const REGISTRY = '0xe691172812761cd8c1efcdbeb89192b35cacb9e7' as const;
/** FireBounty — deployed 24 Oct 2026. */
export const BOUNTY = '0x6ec281aac8f6bec24ba84c56800879b66c13097a' as const;

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
