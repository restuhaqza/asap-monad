#!/usr/bin/env python3
"""
Fetch live fire hotspots and turn them into UI/contract-ready data.

    python3 scripts/fetch-hotspots.py                 # write web/data/hotspots.json
    python3 scripts/fetch-hotspots.py --limit 200     # smaller payload

Source: NASA FIRMS, VIIRS SNPP C2 NRT, South-East Asia, last 24h. Public domain, no API key.
The script prints the keccak256 command you need for `HotspotRegistry.commitBatch`.
"""

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import sys
import urllib.request

CSV_URL = (
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
    "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_24h.csv"
)

# Indonesia bounding box (generous, includes a little of Malaysia/PNG to be trimmed on the map)
LAT_MIN, LAT_MAX = -11.0, 6.0
LON_MIN, LON_MAX = 95.0, 141.0

OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "hotspots.json"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "asap-blitz/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=400, help="max hotspots to keep (by FRP desc)")
    ap.add_argument("--include-nominal", action="store_true", help="keep nominal confidence too")
    args = ap.parse_args()

    raw = fetch(CSV_URL)
    file_hash = hashlib.sha256(raw).hexdigest()

    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
    inside, high = [], 0

    for r in rows:
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (KeyError, ValueError):
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue
        inside.append(r)
        if r.get("confidence") == "high":
            high += 1

    keep = [r for r in inside if args.include_nominal or r.get("confidence") == "high"]
    keep.sort(key=lambda r: float(r.get("frp") or 0), reverse=True)
    keep = keep[: args.limit]

    hotspots = []
    for i, r in enumerate(keep, start=1):
        acq_date, acq_time = r["acq_date"], r["acq_time"].zfill(4)
        hotspots.append(
            {
                "id": i,
                "lat": round(float(r["latitude"]), 4),
                "lon": round(float(r["longitude"]), 4),
                "frp": round(float(r.get("frp") or 0), 2),
                "confidence": r.get("confidence"),
                "acq": f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00+07:00",
                "latE6": int(round(float(r["latitude"]) * 1e6)),
                "lonE6": int(round(float(r["longitude"]) * 1e6)),
                "frpDeci": int(min(round(float(r.get("frp") or 0) * 10), 65535)),
                "acqUnix": int(
                    dt.datetime.strptime(f"{acq_date} {acq_time}", "%Y-%m-%d %H%M")
                    .replace(tzinfo=dt.timezone(dt.timedelta(hours=7)))
                    .timestamp()
                ),
            }
        )

    payload = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).isoformat(timespec="seconds"),
        "source": "NASA FIRMS VIIRS SNPP C2 NRT (South-East Asia, 24h)",
        "source_url": CSV_URL,
        "source_sha256": file_hash,
        "rows_total": len(rows),
        "rows_in_indonesia_bbox": len(inside),
        "high_confidence_in_bbox": high,
        "kept": len(hotspots),
        "hotspots": hotspots,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {OUT} — {len(hotspots)} hotspots")
    print(f"  rows total            : {len(rows)}")
    print(f"  inside Indonesia bbox : {len(inside)}")
    print(f"  high confidence       : {high}")
    print()
    print("Commit the batch on-chain with:")
    print("  cat firms.csv | cast keccak                                    # -> fileHash")
    print('  cast send $REGISTRY "commitBatch(bytes32,string,uint32)" \\')
    print(f'    "$(cat firms.csv | cast keccak)" "{CSV_URL}" {len(hotspots)} \\')
    print("    --rpc-url monad_testnet --private-key $PK")
    print()
    print(f"  # reference sha256 of the same file, for cross-checking: {file_hash}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
