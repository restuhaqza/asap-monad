#!/usr/bin/env bash
#
# Deploy ASAP to Monad mainnet (chain 143) and point the root domain at it.
#
#   ./scripts/deploy-mainnet.sh            # contracts + hotspots + build + deploy
#   ./scripts/deploy-mainnet.sh --contracts-only
#
# Refuses to start without MON on chain 143, because a half-finished mainnet
# deploy is worse than none: the root domain would serve a page reading an
# address that does not exist.

set -euo pipefail

export PATH="$HOME/.config/.foundry/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${MONAD_MAINNET_RPC:-https://rpc.monad.xyz}"
KEY_FILE="${KEY_FILE:-$HOME/.asap-deployer.key}"
CONTRACTS_ONLY=0
[ "${1:-}" = "--contracts-only" ] && CONTRACTS_ONLY=1

[ -f "$KEY_FILE" ] || { echo "no key file at $KEY_FILE"; exit 1; }
PK="$(cat "$KEY_FILE")"
ADDR="$(cast wallet address --private-key "$PK")"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN_ID" = "143" ] || { echo "$RPC answered chain $CHAIN_ID, expected 143"; exit 1; }

BALANCE="$(cast balance "$ADDR" --rpc-url "$RPC")"
if [ "$BALANCE" = "0" ]; then
  cat <<EOF
Blocked: $ADDR holds 0 MON on Monad mainnet (chain 143).

Send MON to that address on mainnet, then run this script again. The whole
deploy — two contracts, the FIRMS batch and one chunk of hotspots — costs on
the order of 0.001 MON at 102 gwei; 0.05 MON is plenty.

Testnet funds cannot be used here. They are a different chain.
EOF
  exit 1
fi

echo "deployer : $ADDR"
echo "balance  : $(cast balance --ether "$ADDR" --rpc-url "$RPC") MON"
echo "gas price: $(cast gas-price --rpc-url "$RPC") wei"

echo
echo "[1/5] deploying HotspotRegistry + FireBounty"
cd "$ROOT/contracts"
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --private-key "$PK"

BROADCAST="$ROOT/contracts/broadcast/Deploy.s.sol/143/run-latest.json"
[ -f "$BROADCAST" ] || { echo "no broadcast record at $BROADCAST"; exit 1; }

read -r REGISTRY BOUNTY <<<"$(python3 - "$BROADCAST" <<'PY'
import json, sys
record = json.load(open(sys.argv[1]))
addrs = [tx["contractAddress"] for tx in record.get("transactions", [])]
print(addrs[0], addrs[1])
PY
)"

echo
echo "HotspotRegistry : $REGISTRY"
echo "FireBounty      : $BOUNTY"
echo "$REGISTRY" > "$ROOT/.mainnet-registry"
echo "$BOUNTY" > "$ROOT/.mainnet-bounty"

echo
echo "[2/5] verifying source on Sourcify (exact match; a failure here does not stop the deploy)"
forge verify-contract "$REGISTRY" src/HotspotRegistry.sol:HotspotRegistry \
  --chain 143 --verifier sourcify --rpc-url "$RPC" --watch || echo "      registry verification failed — check manually"
forge verify-contract "$BOUNTY" src/FireBounty.sol:FireBounty \
  --chain 143 --verifier sourcify --rpc-url "$RPC" --constructor-args "$(cast abi-encode 'f(address)' "$REGISTRY")" --watch \
  || echo "      bounty verification failed — check manually"

echo
echo "[3/5] anchoring and publishing real FIRMS hotspots"
python3 "$ROOT/scripts/push-hotspots.py" \
  --registry "$REGISTRY" \
  --key-file "$KEY_FILE" \
  --rpc "$RPC" \
  --limit 200

if [ "$CONTRACTS_ONLY" = "1" ]; then
  echo
  echo "contracts only — stopping before the web build"
  exit 0
fi

echo
echo "[4/5] building the mainnet bundle"
cd "$ROOT/web/frontend"
cat > .env.mainnet <<EOF
# Mainnet build. Written by scripts/deploy-mainnet.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
VITE_NETWORK=mainnet
VITE_REGISTRY=$REGISTRY
VITE_BOUNTY=$BOUNTY
EOF
npm run build:mainnet

echo
echo "[5/5] deploying the root domain"
npx wrangler deploy -c wrangler.mainnet.jsonc

echo
echo "done — https://asapmonad.web.id now reads chain 143"
