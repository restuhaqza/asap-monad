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
| [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md) | Whitepaper: problem, mechanism design, money flow, game theory, threat model, why Monad, roadmap, state of record · rendered at [asapmonad.web.id/whitepaper](https://asapmonad.web.id/whitepaper) |
| [`docs/FLOW.md`](docs/FLOW.md) / [`docs/diagram.html`](docs/diagram.html) | Alur satelit → kontrak → layar, money flow, arti warna titik |
| [`contracts/src/HotspotRegistry.sol`](contracts/src/HotspotRegistry.sol) | Append-only hotspot record anchored to the source CSV hash |
| [`contracts/src/FireBounty.sol`](contracts/src/FireBounty.sol) | Escrow + responder bonds + verifier quorum + slashing |
| [`contracts/test/FireBounty.t.sol`](contracts/test/FireBounty.t.sol) | 7 tests: payout, bond, radius, timestamp, slash, expiry, self-attest |
| [`scripts/fetch-hotspots.py`](scripts/fetch-hotspots.py) | Pulls live NASA FIRMS data, writes the fixture, prints the `commitBatch` command |
| [`scripts/wallet-tui.sh`](scripts/wallet-tui.sh) | Dev tool: interactive terminal wallet — balance, send MON, switch testnet/mainnet, keystore or in-memory key |
| [`web/frontend/`](web/frontend/) | React 19 + Vite app: Leaflet map, bounty/claim/attest flows, photo evidence upload, payment receipts · 219 Vitest tests |
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
npm run build:testnet   # typecheck, then bundle chain-10143 build to dist/
npm run build:mainnet   # same source, chain-143 build to dist-mainnet/
npm test                # 219 Vitest tests
npm run cf:deploy:testnet   # -> testnet.asapmonad.web.id
npm run cf:deploy:mainnet   # -> asapmonad.web.id (root)
```

The chain is chosen at **build time** (`.env.testnet` / `.env.mainnet`), not at
runtime: one source tree, two bundles, two Workers on one R2 bucket. A page can
never read a testnet address because a query string or a hostname said so.

| Host | Build | Chain |
|---|---|---|
| **https://asapmonad.web.id** (root) | `build:mainnet` | `143` — mainnet |
| **https://testnet.asapmonad.web.id** | `build:testnet` | `10143` — testnet |

App at `/portal` on both hosts, landing at `/`. `scripts/deploy-mainnet.sh`
does the whole mainnet run — deploy, publish hotspots, write `.env.mainnet`,
build, deploy — and refuses to start while the deployer holds 0 MON on 143.

**Live data:**

```bash
python3 scripts/fetch-hotspots.py --limit 200
```

## Deployment

### Hosts

| Host | Bundle | State |
|---|---|---|
| [asapmonad.web.id](https://asapmonad.web.id/portal) | chain `143` | **live** — 191 hotspots on Monad mainnet |
| [testnet.asapmonad.web.id](https://testnet.asapmonad.web.id/portal) | chain `10143` | **live** — 180 hotspots, 4 bounties, one settled payout |

### Monad Testnet — chain `10143` · [explorer](https://testnet.monadscan.com)

| Contract | Address | Source |
|---|---|---|
| `HotspotRegistry` | [`0xe691172812761cd8c1efcdbeb89192b35cacb9e7`](https://testnet.monadscan.com/address/0xe691172812761cd8c1efcdbeb89192b35cacb9e7) | verified · [Sourcify](https://repo.sourcify.dev/10143/0xe691172812761cd8c1efcdbeb89192b35cacb9e7) |
| `FireBounty` | [`0x6ec281aac8f6bec24ba84c56800879b66c13097a`](https://testnet.monadscan.com/address/0x6ec281aac8f6bec24ba84c56800879b66c13097a) | verified · [Sourcify](https://repo.sourcify.dev/10143/0x6ec281aac8f6bec24ba84c56800879b66c13097a) |

Verification is an **exact match** on both contracts (compiler `0.8.24`, optimizer on, 200 runs, `shanghai`). `FireBounty` was deployed with the registry address as its constructor argument. Oracle deployer: `0x9EB20B1420077de8b7e9572b9729b94090a5B8C8`, which is also a whitelisted verifier so the flow can be demonstrated end to end.

Deploy transactions: [`0x60e378aa…c6ace3`](https://testnet.monadscan.com/tx/0x60e378aa29022180b28349a2e67c36b035050b945e0ed60362ad04adf0c6ace3) · [`0xf24c8046…af6b0`](https://testnet.monadscan.com/tx/0xf24c804655cb4859cc4e835dc19b68aa9652489ceee860856921ddc4a5afc6b0)

### Monad Mainnet — chain `143` · [explorer](https://monadscan.com)

| Contract | Address | Source |
|---|---|---|
| `HotspotRegistry` | [`0xe691172812761cd8c1efcdbeb89192b35cacb9e7`](https://monadscan.com/address/0xe691172812761cd8c1efcdbeb89192b35cacb9e7) | verified · [Sourcify](https://repo.sourcify.dev/143/0xe691172812761cd8c1efcdbeb89192b35cacb9e7) |
| `FireBounty` | [`0x6ec281aac8f6bec24ba84c56800879b66c13097a`](https://monadscan.com/address/0x6ec281aac8f6bec24ba84c56800879b66c13097a) | verified · [Sourcify](https://repo.sourcify.dev/143/0x6ec281aac8f6bec24ba84c56800879b66c13097a) |

`exact_match` on both, same compiler settings. **The addresses are identical to testnet, and that is not a typo**: the deployer's nonce was 0 on both chains, so `CREATE` produced the same deterministic address. 191 FIRMS hotspots are anchored on mainnet the same way as on testnet, from one `commitBatch` ([`0x10fe39ad…3d4ede`](https://monadscan.com/tx/0x10fe39adf100ea2195c06be10c0c26fd2588ebc989e0b663d0b8d1a3af3d4ede)) and one `publish` of 191 rows ([`0x1d8e95f2…b65489`](https://monadscan.com/tx/0x1d8e95f2b604e901e5abd005abb3f02eaee11777c3048e2e8e218cb886b65489)).

Mainnet deploy transactions: [`0x60e378aa…c6ace3`](https://monadscan.com/tx/0x60e378aa29022180b28349a2e67c36b035050b945e0ed60362ad04adf0c6ace3) · [`0xf24c8046…af6b0`](https://monadscan.com/tx/0xf24c804655cb4859cc4e835dc19b68aa9652489ceee860856921ddc4a5afc6b0)

**A bounty was answered on mainnet, with real MON, before submission** — the whole lifecycle, six transactions:

| Step | Transaction |
|---|---|
| Fund verifiers B and C (gas only) | [`0x8dfb8697`](https://monadscan.com/tx/0x8dfb8697c4c24bc170ad84b2951e8197e932faacf139e96c9f01389ae0112061) · [`0x319a7931`](https://monadscan.com/tx/0x319a793111bf705e6638bf92660eb56a94cb6ed974eab592db41d832bbc982db) |
| Whitelist both verifiers | [`0x5abb1090`](https://monadscan.com/tx/0x5abb1090a22cd923aa924e648a18d067a30721dc0ae8e9fc15df3039b12f9db6) · [`0xeb202128`](https://monadscan.com/tx/0xeb202128270870b970b86a62b1e9c1a372439b38114de44c6cd7f4ae91d7385a) |
| Open bounty #1 on hotspot 3, 0.05 MON, 6 h | [`0xa316cf0c`](https://monadscan.com/tx/0xa316cf0c45f98746062baf49a54c6ef4fc49ed950ed294dda704ea2bef1c6614) |
| Claim with a 0.05 MON bond, 0 m from the hotspot | [`0x4427aec c`](https://monadscan.com/tx/0x4427aecc977c281719f7f2b4529f3be91353241b355a93edcf47bd3e99f63019) |
| Two verifier approvals → payout in the same block | [`0xee754ba5`](https://monadscan.com/tx/0xee754ba5fa7dff03ee4b77848cae1317dbcb78de376b4b33a22c8ad414047439) · [`0x3265ae51`](https://monadscan.com/tx/0x3265ae5193dae64ff8e5659a89ac5a143df7da65e33f3ac26ecb70cfbbc22d15) |

Open [hotspot #3 on the mainnet app](https://asapmonad.web.id/portal#h=3) and the panel shows the verdict, the responder, the distance (0 m), the approval count (2 of 2) and the evidence hash — read back from the chain, not from a mock.

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
| Hotspots on-chain | ✅ 180 on testnet · 191 on mainnet, each anchored to the FIRMS CSV hash |
| End-to-end settlement | ✅ bounty #1 verified on testnet · a second one settled on **mainnet** with real MON |
| Deployed to Monad testnet | ✅ both contracts, exact-match verified |
| Pusher script writing hotspots on-chain | ✅ 180 hotspots, batch `0x89eb56…` |
| Web app wired to the chain | ✅ [mainnet](https://asapmonad.web.id/portal) and [testnet](https://testnet.asapmonad.web.id/portal) — React 19 + Vite, same source, chain chosen at build time |
| Web app tests | ✅ 219/219 Vitest (lib, hooks, evidence, stats, receipt, both interaction components) |
| `"no responder"` counter | ✅ header counter read from bounty status 4 — **0 today**, no bounty has expired yet; an expiry on bounty #4 becomes callable at 18:22 WIB |
| Payment receipt on verified bounties | ✅ responder, distance, evidence, approvals and verifier reward on every verified bounty; the exact payout appears when this browser waited for the settlement tx, bounties settled earlier say "settled before this build" instead of guessing |
| Deployed to Monad mainnet | ✅ both contracts on chain `143`, exact-match verified on Sourcify |
| Contract addresses in README | ✅ |
| Public live URL | ✅ custom domain on Cloudflare |
| 30 s demo video | ✅ `docs/asap-demo-30s.mp4` |

## Honest limitations

Satellite NRT lags reality by hours — that is exactly why the ground layer must not be gated on it. The radius check uses a flat-earth approximation, valid to ~1% within 8° of the equator. One active claim per bounty. Verification is a trusted quorum today; v2 is stake-weighted verifiers with an appeal window. Full list in [`docs/SPEC.md` §9](docs/SPEC.md).

## Data attribution

Hotspot data: NASA FIRMS (VIIRS SNPP C2 NRT), public domain.
