# ASAP — Fire Response Bounty Network

**Satellites find the fire. Monad pays the person who gets there.**

Indonesia's 2026 fire season is live: 17,108 hotspots detected on 12 October, 26 provinces under haze, Jakarta breathing Kalimantan's smoke. The detection layer already works — SiPongi ingests NASA Terra/Aqua, SNPP and NOAA-20 daily. What is missing is the last mile: a hotspot is a coordinate, not an action, and today the person who physically goes to that coordinate has no budget, no proof of arrival, and no payment.

ASAP is the layer between the satellite and the shovel. A hotspot opens a bounty automatically; the first responder who can prove they got there gets paid in one block.

---

## What's in this repo

| Path | What it is |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Full spec: architecture, sequences, state machine, data model, contract API, invariants, limitations, demo script |
| [`docs/FLOW.md`](docs/FLOW.md) / [`docs/diagram.html`](docs/diagram.html) | Alur satelit → kontrak → layar, money flow, arti warna titik |
| [`contracts/src/HotspotRegistry.sol`](contracts/src/HotspotRegistry.sol) | Append-only hotspot record anchored to the source CSV hash |
| [`contracts/src/FireBounty.sol`](contracts/src/FireBounty.sol) | Escrow + responder bonds + verifier quorum + slashing |
| [`contracts/test/FireBounty.t.sol`](contracts/test/FireBounty.t.sol) | 7 tests: payout, bond, radius, timestamp, slash, expiry, self-attest |
| [`scripts/fetch-hotspots.py`](scripts/fetch-hotspots.py) | Pulls live NASA FIRMS data, writes the fixture, prints the `commitBatch` command |
| [`web/data/hotspots.json`](web/data/hotspots.json) | Generated hotspot fixture used by the app and the pusher |

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

**Live data:**

```bash
python3 scripts/fetch-hotspots.py --limit 200
```

## How it works

1. An oracle (anyone, whitelisted) commits `keccak256` of the raw FIRMS CSV, then publishes the parsed rows. Anyone can re-download the file and prove it wasn't tampered with.
2. A bounty opens on a hotspot, funded by whoever has exposure: the concession, a carbon project, CSR budget, BPBD.
3. A responder stakes a bond ≥ the bounty, submits geotagged evidence. The contract enforces radius and timestamp rules.
4. Two verifiers attest → payout in one block. Two rejections → bond slashed 50/50 to backer and verifiers, bounty reopens.
5. Nobody shows up → `BountyExpired`. That row is the accountability product.

**Mechanism invariants:** bond ≥ pool makes fake reports unprofitable · evidence can't predate the satellite pass · a claim settles once · the contract holds zero balance in every terminal state.

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
| Deployed to Monad testnet | ⬜ next |
| Pusher script writing hotspots on-chain | ⬜ next |
| Web app wired to the chain | ⬜ next |
| Mainnet deploy + verification | ⬜ before 16:30 |
| README live URL + contract address | ⬜ fill after deploy |

## Honest limitations

Satellite NRT lags reality by hours — that is exactly why the ground layer must not be gated on it. The radius check uses a flat-earth approximation, valid to ~1% within 8° of the equator. One active claim per bounty. Verification is a trusted quorum today; v2 is stake-weighted verifiers with an appeal window. Full list in [`docs/SPEC.md` §9](docs/SPEC.md).

## Data attribution

Hotspot data: NASA FIRMS (VIIRS SNPP C2 NRT), public domain.
