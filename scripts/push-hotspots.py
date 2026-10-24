#!/usr/bin/env python3
"""
Push real NASA FIRMS hotspots on-chain.

    python3 scripts/push-hotspots.py --dry-run                  # show what would be sent
    python3 scripts/push-hotspots.py --registry 0x... --key-file ~/.key --limit 200

Two steps, matching the contracts:
  1. commitBatch(fileHash, fileUrl, count) — anchor the raw CSV before writing rows
  2. publish(batchId, rows)                — write the parsed hotspots, ~200 per tx

The batch id is deterministic: keccak256(abi.encode(fileHash, count)), so it can be computed
locally and checked against the BatchCommitted event.
"""

import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import subprocess
import sys
import urllib.request

CSV_URL = (
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
    "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_24h.csv"
)
LAT_MIN, LAT_MAX = -11.0, 6.0
LON_MIN, LON_MAX = 95.0, 141.0
CONF = {"low": 0, "nominal": 1, "high": 2}
WIB = dt.timezone(dt.timedelta(hours=7))


def cast(*args, input_bytes=None, check=True):
    r = subprocess.run(["cast", *args], input=input_bytes, capture_output=True)
    if check and r.returncode != 0:
        sys.exit(f"cast {' '.join(args)} failed:\n{r.stderr.decode()}")
    return r.stdout.decode().strip()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "asap-blitz/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def parse(raw, limit):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8"))):
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (KeyError, ValueError):
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue
        if r.get("confidence") != "high":
            continue
        acq_date, acq_time = r["acq_date"], r["acq_time"].zfill(4)
        unix = int(
            dt.datetime.strptime(f"{acq_date} {acq_time}", "%Y-%m-%d %H%M")
            .replace(tzinfo=WIB)
            .timestamp()
        )
        rows.append(
            (
                int(round(lat * 1e6)),
                int(round(lon * 1e6)),
                int(min(round(float(r.get("frp") or 0) * 10), 65535)),
                unix,
                CONF[r["confidence"]],
            )
        )

    rows.sort(key=lambda t: -t[2])
    # the registry dedupes on (lat, lon, acqTime); drop duplicates locally too
    seen, unique = set(), []
    for row in rows:
        key = (row[0], row[1], row[3])
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--registry", help="HotspotRegistry address")
    ap.add_argument("--key-file", default=str(pathlib.Path.home() / ".asap-deployer.key"))
    ap.add_argument("--rpc", default="https://testnet-rpc.monad.xyz")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--chunk", type=int, default=200, help="rows per publish transaction")
    ap.add_argument("--source-url", default=CSV_URL)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    raw = fetch(args.source_url)
    file_hash = cast("keccak", input_bytes=raw)
    rows = parse(raw, args.limit)
    if not rows:
        sys.exit("no high-confidence hotspots found")

    enc = cast("abi-encode", "f(bytes32,uint32)", file_hash, str(len(rows)))
    batch_id = cast("keccak", enc)

    print(f"source      : {args.source_url}")
    print(f"bytes       : {len(raw)}")
    print(f"fileHash    : {file_hash}")
    print(f"rows        : {len(rows)}")
    print(f"batchId     : {batch_id}  (keccak256(abi.encode(fileHash, {len(rows)})))")
    print(f"largest FRP : {rows[0][2] / 10:.0f} MW at {rows[0][0] / 1e6:.4f}, {rows[0][1] / 1e6:.4f}")

    if args.dry_run:
        print("\nfirst 3 rows (latE6, lonE6, frpDeci, acqTime, confidence):")
        for r in rows[:3]:
            print("  ", r)
        print("\ndry run — nothing sent")
        return

    if not args.registry:
        sys.exit("--registry is required unless --dry-run")

    pk = pathlib.Path(args.key_file).read_text().strip()
    common = ["--rpc-url", args.rpc, "--private-key", pk, "--json"]

    print("\n[1/2] commitBatch")
    out = json.loads(cast("send", args.registry,
                          "commitBatch(bytes32,string,uint32)",
                          file_hash, args.source_url, str(len(rows)), *common))
    print("      tx", out.get("transactionHash"))

    print(f"\n[2/2] publish in chunks of {args.chunk}")
    for start in range(0, len(rows), args.chunk):
        chunk = rows[start:start + args.chunk]
        tuples = "[" + ",".join(f"({a},{b},{c},{d},{e})" for a, b, c, d, e in chunk) + "]"
        out = json.loads(cast("send", args.registry,
                              "publish(bytes32,(int32,int32,uint16,uint32,uint8)[])",
                              batch_id, tuples, *common))
        print(f"      rows {start + 1}-{start + len(chunk)}  tx {out.get('transactionHash')}")

    count = cast("call", args.registry, "hotspotCount()(uint256)", "--rpc-url", args.rpc)
    print(f"\nhotspotCount on-chain: {count}")


if __name__ == "__main__":
    main()
