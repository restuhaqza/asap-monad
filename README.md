# ASAP — Fire Response Bounty Network

**Satellites find the fire. Monad pays the person who gets there.**

Indonesia's 2026 fire season is live: 17,108 hotspots detected on 12 October, 26 provinces under haze, Jakarta breathing Kalimantan's smoke. The detection layer already works — SiPongi ingests NASA Terra/Aqua, SNPP and NOAA-20 daily. What is missing is the last mile: a hotspot is a coordinate, not an action, and today the person who physically goes to that coordinate has no budget, no proof of arrival, and no payment.

ASAP is the layer between the satellite and the shovel. A hotspot opens a bounty automatically; the first responder who can prove they got there gets paid in one block.

---

**Demo video:** [`docs/asap-demo-30s.mp4`](docs/asap-demo-30s.mp4) — 30 s, 1920×1080, narrated, built from screenshots of the live app captured at 2× on 24 Oct 2026. Nothing in it is a mockup; the only drawn elements are the two amber boxes and the `bond ≥ pool` label on the real bounty panel.

## What's in this repo

| Path | What it is |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Full spec: architecture, sequences, state machine, data model, contract API, invariants, limitations, demo script |
| [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md) | Whitepaper: problem, mechanism design, money flow, game theory, threat model, why Monad, roadmap, state of record |
| [`docs/FLOW.md`](docs/FLOW.md) / [`docs/diagram.html`](docs/diagram.html) | Alur satelit → kontrak → layar, money flow, arti warna titik |
| [`contracts/src/HotspotRegistry.sol`](contracts/src/HotspotRegistry.sol) | Append-only hotspot record anchored to the source CSV hash |
| [`contracts/src/FireBounty.sol`](contracts/src/FireBounty.sol) | Escrow + responder bonds + verifier quorum + slashing |
| [`contracts/test/FireBounty.t.sol`](contracts/test/FireBounty.t.sol) | 7 tests: payout, bond, radius, timestamp, slash, expiry, self-attest |
| [`scripts/fetch-hotspots.py`](scripts/fetch-hotspots.py) | Pulls live NASA FIRMS data, writes the fixture, prints the `commitBatch` command |
| [`scripts/wallet-tui.sh`](scripts/wallet-tui.sh) | Dev tool: interactive terminal wallet — balance, send MON, switch testnet/mainnet, keystore or in-memory key |
| [`web/frontend/`](web/frontend/) | React 19 + Vite app: Leaflet map, bounty/claim/attest flows, photo evidence upload, payment receipts · 209 Vitest tests |
| [`web/data/hotspots.json`](web/data/hotspots.json) | Generated hotspot fixture used by the pusher |
| [`docs/asap-demo-30s.mp4`](docs/asap-demo-30s.mp4) | 30 s demo cut: the gap, the bounty, the payout |

## Quickstart

**Contracts and tests:**

```bash
cd contracts
forge test                 # 7 passed — forge-std is vendored, no `forge install` needed
forge build

# testnet (chain 10143)
forge script script/Deploy.s.sol --rpc-url monad_testnet \
  --broadcast --private-key $PK

# mainnet (chain 143) — 25 bonus points, same script
forge script script/Deploy.s.sol --rpc-url monad_mainnet \
  --broadcast --private-key $PK
```

**Web app:**

```bash
cd web/frontend
npm install
npm run dev          # http://localhost:5173 — app plus a dev evidence endpoint
npm run build        # typecheck, then bundle to dist/
npm test             # 209 Vitest tests
npx wrangler deploy  # Cloudflare Worker: static assets + /api/evidence
```

Landing: **https://asapmonad.web.id** · App: **https://asapmonad.web.id/portal** · chain `10143`

**Live data:**

```bash
python3 scripts/fetch-hotspots.py --limit 200
```

## Deployment

**Monad Testnet** — chain `10143` · [explorer](https://testnet.monadscan.com)

| Contract | Address | Source |
|---|---|---|
| `HotspotRegistry` | [`0xe691172812761cd8c1efcdbeb89192b35cacb9e7`](https://testnet.monadscan.com/address/0xe691172812761cd8c1efcdbeb89192b35cacb9e7) | verified · [Sourcify](https://repo.sourcify.dev/10143/0xe691172812761cd8c1efcdbeb89192b35cacb9e7) |
| `FireBounty` | [`0x6ec281aac8f6bec24ba84c56800879b66c13097a`](https://testnet.monadscan.com/address/0x6ec281aac8f6bec24ba84c56800879b66c13097a) | verified · [Sourcify](https://repo.sourcify.dev/10143/0x6ec281aac8f6bec24ba84c56800879b66c13097a) |

Verification is an **exact match** on both contracts (compiler `0.8.24`, optimizer on, 200 runs, `shanghai`). `FireBounty` was deployed with the registry address as its constructor argument. Oracle deployer: `0x9EB20B1420077de8b7e9572b9729b94090a5B8C8`, which is also a whitelisted verifier so the flow can be demonstrated end to end.

## How it works

1. An oracle (anyone, whitelisted) commits `keccak256` of the raw FIRMS CSV, then publishes the parsed rows. Anyone can re-download the file and prove it wasn't tampered with.
2. A bounty opens on a hotspot, funded by whoever has exposure: the concession, a carbon project, CSR budget, BPBD.
3. A responder stakes a bond ≥ the bounty, submits geotagged evidence. The contract enforces radius and timestamp rules.
4. Two verifiers attest → payout in one block. Two rejections → bond slashed 50/50 to backer and verifiers, bounty reopens.
5. Nobody shows up → `BountyExpired`. That row is the accountability product.

**Mechanism invariants:** bond ≥ pool makes fake reports unprofitable · evidence can't predate the satellite pass · a claim settles once · the contract holds zero balance in every terminal state.

**Photo evidence:** the claim form takes a photo, compresses it to 1280 px JPEG in the browser, and uploads it to a Worker that stores the bytes in R2 keyed by their SHA-256. The evidence string written on-chain is that content-addressed URL, so the same photo always resolves to the same immutable object and nobody can overwrite someone else's proof. The claim button stays disabled until the photo is stored and the required bond has actually been read from the contract.

## Why Monad

- **Embarrassingly parallel workload.** Every hotspot is an independent escrow. ~22,760 detections/day × claims × attestations is tens of thousands of *independent* state transitions — the case parallel execution exists for.
- **Micro-bounty economics.** A village volunteer's bounty is ~$10–30. At $0.20 gas the mechanism is dead; at Monad fees it's noise.
- **Finality is functional.** Nobody wants to wait 30s to learn their evidence landed while another responder claims the same fire.
- **Gas is charged on `gas_limit`, not gas used** — with 200-hotspot batch writes, an unmeasured limit burns real money every batch.

## Status

| Item | State |
|---|---|
| Contracts implemented | ✅ compile clean |
| Tests | ✅ 7/7 passing |
| Hotspot data pipeline | ✅ live NASA FIRMS, no API key |
| Hotspots on-chain | ✅ 180 high-confidence detections |
| End-to-end settlement | ✅ bounty #1 verified, responder paid |
| Deployed to Monad testnet | ✅ both contracts, verified |
| Pusher script writing hotspots on-chain | ✅ 180 hotspots, batch `0x89eb56…` |
| Web app wired to the chain | ✅ [asapmonad.web.id/portal](https://asapmonad.web.id/portal) — React 19 + Vite |
| Web app tests | ✅ 209/209 Vitest (lib, hooks, evidence, stats, receipt, both interaction components) |
| `"no responder"` counter | ✅ header counter read from bounty status 4 — **0 today**, no bounty has expired yet; an expiry on bounty #4 becomes callable at 18:22 WIB |
| Payment receipt on verified bounties | ✅ responder, distance, evidence, approvals and verifier reward on every verified bounty; the exact payout appears when this browser waited for the settlement tx, bounties settled earlier say "settled before this build" instead of guessing |
| Mainnet deploy + verification | ⬜ before 16:30 |
| Contract addresses in README | ✅ |
| Public live URL | ✅ custom domain on Cloudflare |
| 30 s demo video | ✅ `docs/asap-demo-30s.mp4` |

## Honest limitations

Satellite NRT lags reality by hours — that is exactly why the ground layer must not be gated on it. The radius check uses a flat-earth approximation, valid to ~1% within 8° of the equator. One active claim per bounty. Verification is a trusted quorum today; v2 is stake-weighted verifiers with an appeal window. Full list in [`docs/SPEC.md` §9](docs/SPEC.md).

## Data attribution

Hotspot data: NASA FIRMS (VIIRS SNPP C2 NRT), public domain.
