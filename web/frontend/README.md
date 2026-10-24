# ASAP web — React + Vite frontend

Fire response bounties on Monad. The map reads hotspots straight from
`HotspotRegistry` on Monad Testnet (chain `10143`), the rail funds and claims
bounties through `FireBounty`, and a small Cloudflare Worker stores claim
evidence in R2.

This is the React port of the original vanilla build in `../app/`. The old
folder is untouched and stays deployable; this one is the maintained version.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — SPA + a dev-only evidence endpoint
```

`vite dev` has no Cloudflare Worker, so `/api/evidence` and `/evidence/<key>`
are served by the same pure handlers with an **in-memory** store (photos vanish
when the dev server restarts). Nothing else is mocked: hotspots and bounties are
read from the live RPC in paced waves.

```bash
npm run build      # tsc -b && vite build → dist/
npm run preview    # static preview of dist/ (no evidence endpoint)
```

## Run the real worker locally

```bash
npm run build      # the worker serves ./dist through the ASSETS binding
npm run cf:dev     # wrangler dev — reads assets, routes /api/* and /evidence/* to worker.ts
```

`wrangler dev` uses a local Miniflare R2 bucket, so no Cloudflare account or
bucket is needed for local runs. `npm run cf:deploy` deploys the worker plus
`dist/`; the domain is intentionally not configured in `wrangler.jsonc`.

## Evidence API

Content-addressed: the storage key is the SHA-256 of the bytes, so the same
photo always maps to the same URL and nobody can overwrite someone else's
evidence. Logic lives in `src/lib/evidence.ts` (pure, no Cloudflare imports) and
is adapted to R2 in `worker.ts`.

| Route | Behaviour |
|---|---|
| `POST /api/evidence` | Raw image body (no multipart). `image/jpeg`, `image/png`, `image/webp`. Max 3 MB. → `200 { url, sha256, bytes }`, `415` unsupported type, `400` empty, `413` too large. |
| `GET /evidence/<sha256>.<jpg\|png\|webp>` | Streams the stored bytes with `cache-control: public, max-age=31536000, immutable` and `access-control-allow-origin: *`. → `400` malformed key, `404` missing. `HEAD` is supported. |

The browser side (`src/lib/compress.ts` → `src/lib/evidence-client.ts`) downscales
the photo to a 1280 px long edge, re-encodes it as JPEG q0.82, uploads it and
uses the returned absolute URL as the on-chain evidence string.

## How the old vanilla app maps onto this structure

`web/app/app.js` was one 522-line module that owned the Leaflet map, the DOM and
the chain clients. Here the same behaviour is split by responsibility:

| Old | New |
|---|---|
| `config.js` | `src/lib/config.ts` (chain, contracts, wave sizes, map defaults) |
| inline ABIs in `app.js` | `src/lib/contracts.ts` |
| `createPublicClient` / `createWalletClient` + `load()`, `refreshBounties()` | `src/lib/chain.ts` (typed reads) + `src/hooks/useHotspots.ts` (pacing, progressive paint, cache) |
| map setup, `drawMarkers()`, `recolor()` | `src/components/MapView.tsx` (map instance + marker map in refs, imperative handle) |
| `render()` / `#list` innerHTML | `src/components/HotspotList.tsx`, `src/components/Stats.tsx` |
| `openDetail()` + `#controls` innerHTML | `src/components/DetailPanel.tsx`, `OpenBountyForm.tsx`, `EvidencePicker.tsx` |
| `toast()` | `src/hooks/useToast.ts` + `src/components/Toast.tsx` |
| `connect()` / `ensureChain()` | `src/hooks/useWallet.ts` + `src/lib/eip1193.ts` |
| `tx()` | `src/hooks/useBountyActions.ts` |
| `compress()` / `uploadEvidence()` | `src/lib/compress.ts` / `src/lib/evidence-client.ts` |
| `index.html` styles | `src/styles.css` (same tokens and classes, `.ev-drop` removed, mobile layout added) |
| `worker.js` | `worker.ts` + `src/lib/evidence.ts` |

## Notes and deliberate changes

- **No `eth_getLogs`, no Multicall3.** The public RPC caps logs at 100 blocks and
  Multicall3 answered inconsistently. State is read id by id: hotspots in waves
  of 10 every ~1.1 s (max 80 shown, retry pass in waves of 6), bounties in waves
  of 12 every ~0.85 s.
- **One hotspot may have several bounties.** The rail and the detail panel show
  the **largest pool**, not the most recent one.
- **Deep links** (`#h=<id>`) open as soon as that hotspot's wave lands
  (`src/hooks/useDeepLink.ts`). The old build evaluated the hash in a scope where
  the variable did not exist, so the `ReferenceError` was swallowed by the RPC
  error toast and the deep link silently never worked.
- **Scroll-wheel zoom is off** (`scrollWheelZoom: false`) so a stray scroll does
  not teleport the map; the zoom control sits bottom-right.
- The claim button is disabled until an upload or a manual URL/CID exists — the
  old code had a `'ipfs://unset'` fallback in the write call that would have
  submitted a placeholder if the gate were ever bypassed.

## Tests

`vite.config.ts` already carries the Vitest block (`jsdom`, globals,
`src/test/setup.ts` with `@testing-library/jest-dom/vitest`). Pure logic in
`src/lib/` is written to be tested without rendering. Run with `npx vitest`.
