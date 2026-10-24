#!/usr/bin/env bash
# =============================================================================
#  ASAP Wallet - a small interactive TUI wallet for Monad (testnet / mainnet)
#
#  Basic wallet needs, nothing else:
#    - live balance, nonce, block, gas price
#    - send MON with an estimate + explicit confirmation
#    - switch between Monad testnet (10143) and mainnet (143)
#    - watch-only address, raw key (memory only), or foundry keystore account
#    - ERC20 balance check, tx receipt lookup, explorer links
#
#  Requirements: bash, curl, jq, cast (foundry). No other dependency.
#
#  Keys: this tool never writes a private key to disk. A raw key lives only in
#  this process memory and is handed to `cast` as an argument, so it is visible
#  to other processes of the same user for the lifetime of that call. For
#  anything holding real value use a keystore account instead:
#      cast wallet import dev --interactive
#
#  Usage:
#      ./scripts/wallet-tui.sh                       # interactive
#      ./scripts/wallet-tui.sh --net mainnet         # start on mainnet
#      ./scripts/wallet-tui.sh --once                # print one status frame
#      ./scripts/wallet-tui.sh --help
# =============================================================================

set -uo pipefail

# foundry installs outside PATH on this machine
if [ -x "$HOME/.config/.foundry/bin/cast" ]; then
  PATH="$HOME/.config/.foundry/bin:$PATH"
fi

VERSION="1.0.0"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/asap-wallet"
STATE_FILE="$STATE_DIR/state"
TMP_BODY="$(mktemp -t asap-wallet.XXXXXX)"
trap 'rm -f "$TMP_BODY"' EXIT

# ---------------------------------------------------------------- defaults --
NET="testnet"
W_ADDR="${ADDRESS:-}"
ACCOUNT="${ACCOUNT:-}"
TOKEN=""
PK_MEM="${PRIVATE_KEY:-${PK:-}}"     # memory only, never persisted
MON_IDR="${MON_IDR:-}"               # e.g. 15000 -> "≈ Rp ..."
ONCE=0
ASK_KEY=0
CLI_ADDR=""
HAVE_NET=0; HAVE_ADDR=0; HAVE_ACCOUNT=0; HAVE_IDR=0

RPC=""
CHAIN_ID=""
EXPLORER=""
NET_LABEL=""

BAL_WEI=""
BLOCK_NO=""
GAS_PRICE_WEI=""
NONCE=""
LATENCY_MS=""
CHECKED_AT=""
CHECKED_EPOCH=0
STATS_ERR=""

MSG=""
MSG_KIND="info"

# ------------------------------------------------------------------ colors --
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_RST=$'\033[0m'; C_DIM=$'\033[2m'; C_B=$'\033[1m'
  C_C=$'\033[36m';  C_G=$'\033[32m'; C_Y=$'\033[33m'
  C_R=$'\033[31m';  C_M=$'\033[35m'; C_W=$'\033[97m'
else
  C_RST=""; C_DIM=""; C_B=""; C_C=""; C_G=""; C_Y=""; C_R=""; C_M=""; C_W=""
fi

# --------------------------------------------------------------- arg parse --
usage() {
  cat <<'EOF'
ASAP Wallet - interactive basic wallet for Monad

Usage:
  wallet-tui.sh [options]

Options:
  --net <testnet|mainnet>   network to start on            (default: testnet)
  --addr <0x...>            watch address
  --account <name>          foundry keystore account (~/.foundry/keystores)
  --key <0x...>             raw private key (memory only; prefer a keystore)
  --ask-key                 prompt for the private key on start (hidden input)
  --idr <rate>              show IDR estimates at this MON/IDR rate
  --once                    print one status frame and exit (no TUI)
  -h, --help                this text
  -v, --version             version

Keys inside the TUI: arrow keys / j k to move, enter to select, q to quit.
EOF
}

need_arg() { [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --net)      need_arg "$@"; NET="$2"; HAVE_NET=1; shift 2 ;;
    --addr)     need_arg "$@"; CLI_ADDR="$2"; HAVE_ADDR=1; shift 2 ;;
    --account)  need_arg "$@"; ACCOUNT="$2"; HAVE_ACCOUNT=1; shift 2 ;;
    --key)      need_arg "$@"; PK_MEM="$2"; shift 2 ;;
    --ask-key)  ASK_KEY=1; shift ;;
    --idr)      need_arg "$@"; MON_IDR="$2"; HAVE_IDR=1; shift 2 ;;
    --once)     ONCE=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    -v|--version) echo "asap-wallet $VERSION"; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------- state --
load_state() {
  [ -f "$STATE_FILE" ] || return 0
  local k v
  while IFS='=' read -r k v; do
    case "$k" in
      network) [ "$HAVE_NET" = 0 ] && NET="$v" ;;
      address) [ "$HAVE_ADDR" = 0 ] && W_ADDR="$v" ;;
      account) [ "$HAVE_ACCOUNT" = 0 ] && ACCOUNT="$v" ;;
      token)   TOKEN="$v" ;;
      mon_idr) [ "$HAVE_IDR" = 0 ] && MON_IDR="$v" ;;
    esac
  done < "$STATE_FILE"
}

save_state() {
  mkdir -p "$STATE_DIR"
  ( umask 077
    {
      printf 'network=%s\n' "$NET"
      printf 'address=%s\n' "$W_ADDR"
      printf 'account=%s\n' "$ACCOUNT"
      printf 'token=%s\n' "$TOKEN"
      printf 'mon_idr=%s\n' "$MON_IDR"
    } > "$STATE_FILE" )
}

# -------------------------------------------------------------- net helpers --
set_network() {
  case "$1" in
    testnet|10143)
      NET="testnet"; RPC="https://testnet-rpc.monad.xyz"
      CHAIN_ID="10143"; EXPLORER="https://testnet.monadscan.com"; NET_LABEL="MONAD TESTNET" ;;
    mainnet|143)
      NET="mainnet"; RPC="https://rpc.monad.xyz"
      CHAIN_ID="143"; EXPLORER="https://monadscan.com"; NET_LABEL="MONAD MAINNET" ;;
    *) echo "unknown network: $1 (testnet|mainnet)" >&2; exit 2 ;;
  esac
}

toggle_network() {
  if [ "$NET" = "testnet" ]; then set_network mainnet; else set_network testnet; fi
  clear_stats
  save_state
}

clear_stats() {
  BAL_WEI=""; BLOCK_NO=""; GAS_PRICE_WEI=""; NONCE=""
  LATENCY_MS=""; CHECKED_AT=""; STATS_ERR=""; CHECKED_EPOCH=0
}

# -------------------------------------------------------------- formatting --
commify() {
  local s="${1:-0}" out=""
  [ -z "$s" ] && s="0"
  while [ ${#s} -gt 3 ]; do
    out=",${s:${#s}-3:3}$out"
    s="${s:0:${#s}-3}"
  done
  printf '%s%s' "$s" "$out"
}

# wei (decimal string) -> 12,345.678901 MON (6 dp, exact, no float math)
fmt_mon() {
  local w="${1:-0}" neg="" int_part frac
  case "$w" in -*) neg="-"; w="${w#-}" ;; esac
  [ -z "$w" ] && w="0"
  while [ ${#w} -le 18 ]; do w="0$w"; done
  int_part="${w:0:${#w}-18}"
  frac="${w:${#w}-18}"
  printf '%s%s.%s' "$neg" "$(commify "$int_part")" "${frac:0:6}"
}

# short 0x1234...abcd
short_addr() {
  local a="${1:-}"
  if [ ${#a} -ge 12 ]; then printf '%s...%s' "${a:0:6}" "${a:${#a}-4}"; else printf '%s' "${a:-<none>}"; fi
}

is_addr() { case "${1:-}" in 0x*) [ ${#1} -eq 42 ] && printf '%s' "$1" | grep -Eq '^0x[0-9a-fA-F]{40}$' ;; *) return 1 ;; esac; }

is_amount() { printf '%s' "${1:-}" | grep -Eq '^[0-9]+(\.[0-9]{1,18})?$'; }

# decimal wei strings -> MON, 9 dp (display only, float is fine here)
mul_mon() { awk -v a="$1" -v b="$2" 'BEGIN{ printf "%.9f", (a*b)/1e18 }'; }
sum_mon() { awk -v a="$1" -v b="$2" 'BEGIN{ printf "%.9f", a+b }'; }

idr_of() { # <mon-as-decimal-string>
  [ -n "$MON_IDR" ] || { printf ''; return; }
  awk -v a="$1" -v r="$MON_IDR" 'BEGIN{ printf "%.0f", a*r }'
}

# --------------------------------------------------------------- rpc fetch --
# One batched JSON-RPC round trip instead of four `cast` spawns (~0.5s vs ~1.9s).
fetch_stats() {
  [ -n "$W_ADDR" ] || { clear_stats; return 1; }
  STATS_ERR=""

  local payload body tt
  payload=$(printf '[{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["%s","latest"]},{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]},{"jsonrpc":"2.0","id":3,"method":"eth_gasPrice","params":[]},{"jsonrpc":"2.0","id":4,"method":"eth_getTransactionCount","params":["%s","latest"]}]' "$W_ADDR" "$W_ADDR")

  if ! tt=$(curl -sS --max-time 10 -o "$TMP_BODY" -w '%{time_total}' -X POST \
        -H 'content-type: application/json' -d "$payload" "$RPC" 2>/dev/null); then
    STATS_ERR="rpc unreachable - press r to retry"
    return 1
  fi
  LATENCY_MS=$(awk -v t="${tt:-0}" 'BEGIN{ printf "%.0f", t * 1000 }')

  body=$(cat "$TMP_BODY")
  case "$body" in *'"result"'*) ;; *) STATS_ERR="bad rpc response"; return 1 ;; esac

  if command -v jq >/dev/null 2>&1; then
    local bh gh nh
    bh=$(printf '%s' "$body" | jq -r '[.[]|select(.id==1)][0].result // empty')
    BLOCK_NO=$(printf '%s' "$body" | jq -r '[.[]|select(.id==2)][0].result // empty')
    gh=$(printf '%s' "$body" | jq -r '[.[]|select(.id==3)][0].result // empty')
    nh=$(printf '%s' "$body" | jq -r '[.[]|select(.id==4)][0].result // empty')
    [ -n "$bh" ] && BAL_WEI=$(cast to-dec "$bh" 2>/dev/null)
    [ -n "$BLOCK_NO" ] && BLOCK_NO=$(cast to-dec "$BLOCK_NO" 2>/dev/null)
    [ -n "$gh" ] && GAS_PRICE_WEI=$(cast to-dec "$gh" 2>/dev/null)
    [ -n "$nh" ] && NONCE=$(cast to-dec "$nh" 2>/dev/null)
  else
    # no jq: four casts, slower but identical numbers
    BAL_WEI=$(cast balance "$W_ADDR" --rpc-url "$RPC" 2>/dev/null)
    BLOCK_NO=$(cast block-number --rpc-url "$RPC" 2>/dev/null)
    GAS_PRICE_WEI=$(cast gas-price --rpc-url "$RPC" 2>/dev/null)
    NONCE=$(cast nonce "$W_ADDR" --rpc-url "$RPC" 2>/dev/null)
  fi

  [ -n "$BAL_WEI" ] || { STATS_ERR="could not read balance"; return 1; }
  CHECKED_AT=$(date '+%H:%M:%S')
  CHECKED_EPOCH=$(date +%s)
  return 0
}

# ------------------------------------------------------------ wallet shape --
derive_addr_from_pk() {
  [ -n "$PK_MEM" ] || return 1
  local a
  a=$(cast wallet address --private-key "$PK_MEM" 2>/dev/null) || return 1
  printf '%s' "$a"
}

wallet_kind() {
  if [ -n "$PK_MEM" ]; then printf 'key in memory'
  elif [ -n "$ACCOUNT" ]; then printf 'keystore:%s' "$ACCOUNT"
  else printf 'watch only'; fi
}

has_signer() { [ -n "$PK_MEM" ] || [ -n "$ACCOUNT" ]; }

# ------------------------------------------------------------------ drawing --
inner_width() {
  local cols
  cols=$(tput cols 2>/dev/null || echo 80)
  # 1 margin left, 1 right, 2 borders => content width
  [ "$cols" -gt 84 ] && cols=84
  [ "$cols" -lt 56 ] && cols=56
  echo $(( cols - 2 ))
}

hline() {
  local n="$1" s=""
  while [ ${#s} -lt "$n" ]; do s="${s}─"; done
  printf '%s' "$s"
}

# row <plain-ASCII-text> [color]
row() {
  local plain="$1" col="${2:-}" pad
  pad=$(( W - 2 - ${#plain} ))
  [ "$pad" -lt 0 ] && pad=0
  printf '%s│%s %s%s%*s%s│%s\n' "$C_DIM" "$col" "$plain" "$C_RST" "$pad" "" "$C_DIM" "$C_RST"
}

menu_row() {
  local idx="$1" label="$2" hint="$3" cur="$4" mark=" " mark_c="" lbl_c="" plain colored pad
  local padded
  if [ "$cur" = "$idx" ]; then mark=">"; mark_c="$C_C$C_B"; lbl_c="$C_B"; fi
  plain=$(printf '%s %-36s  %s' "$mark" "$label" "$hint")
  padded=$(printf '%-36s' "$label")
  colored=$(printf '%s%s%s %s%s%s  %s%s%s' \
            "$mark_c" "$mark" "$C_RST" "$lbl_c" "$padded" "$C_RST" \
            "$C_DIM" "$hint" "$C_RST")
  pad=$(( W - 2 - ${#plain} ))
  [ "$pad" -lt 0 ] && pad=0
  printf '%s│%s %s%*s%s│%s\n' "$C_DIM" "$colored" "" "$pad" "" "$C_DIM" "$C_RST"
}

msg_row() {
  local text="$1" col="$2" plain pad
  plain=" $text"
  pad=$(( W - 2 - ${#plain} ))
  [ "$pad" -lt 0 ] && pad=0
  printf '%s│%s %s%s%*s%s│%s\n' "$C_DIM" "$col" "$plain" "$C_RST" "$pad" "" "$C_DIM" "$C_RST"
}

# --------------------------------------------------------------- main frame --
MENU_ITEMS=(
  "Refresh balances|r"
  "Send MON|s"
  "Switch network|n"
  "Wallet: address / key / account|w"
  "ERC20 balance check|t"
  "Transaction receipt|x"
  "Open explorer|o"
  "Copy address|c"
  "Help|h"
  "Quit|q"
)
MENU_KEYS=(refresh send network wallet erc20 receipt explorer copy help quit)
SEL=0

draw_main() {
  local W i label hint shown_net nkeys
  W=$(inner_width)
  local out=""
  out+=$'\033[H\033[2J'

  # title
  out+=$(printf '%s╭%s╮%s\n' "$C_DIM" "$(hline "$W")" "$C_RST")
  local title=" ASAP WALLET" right
  case "$NET" in testnet) right="TESTNET 10143  " ;; *) right="MAINNET 143  " ;; esac
  local pad=$(( W - ${#title} - ${#right} ))
  [ "$pad" -lt 0 ] && pad=0
  out+=$(printf '%s│%s%s%s%s%*s%s%s│%s\n' "$C_DIM" "$C_B$C_W" "$title" "$C_RST" "" "$pad" "" \
          "$([ "$NET" = mainnet ] && printf '%s' "$C_M" || printf '%s' "$C_C")" "$right" "$C_RST")
  out+=$(printf '%s├%s┤%s\n' "$C_DIM" "$(hline "$W")" "$C_RST")

  # stats
  local bal_line addr_line
  if [ -n "$STATS_ERR" ]; then
    bal_line="balance   ! $STATS_ERR"
  elif [ -n "$BAL_WEI" ]; then
    bal_line="balance   $(fmt_mon "$BAL_WEI") MON"
    local r; r=$(idr_of "$(fmt_mon "$BAL_WEI" | tr -d ',')")
    [ -n "$r" ] && bal_line="$bal_line   (≈ Rp $(commify "$r"))"
  else
    bal_line="balance   - press r to load -"
  fi
  out+=$(row "$bal_line" "$C_G")
  out+=$(row "address   $(short_addr "$W_ADDR")   [$(wallet_kind)]" "$C_W")

  local blk_line
  if [ -n "$BLOCK_NO" ] && [ -n "$GAS_PRICE_WEI" ]; then
    local gas_gwei fee
    gas_gwei=$(awk -v g="$GAS_PRICE_WEI" 'BEGIN{ printf "%.2f", g/1e9 }')
    fee=$(mul_mon 21000 "$GAS_PRICE_WEI")
    blk_line="chain     block $(commify "$BLOCK_NO") · nonce ${NONCE:-?} · gas ${gas_gwei} gwei"
    out+=$(row "$blk_line")
    out+=$(row "          transfer fee ≈ $fee MON · checked ${CHECKED_AT:-?}" "$C_DIM")
  else
    out+=$(row "chain     - press r to load -" "$C_DIM")
  fi

  out+=$(printf '%s├%s┤%s\n' "$C_DIM" "$(hline "$W")" "$C_RST")
  nkeys=${#MENU_ITEMS[@]}
  for (( i=0; i<nkeys; i++ )); do
    label="${MENU_ITEMS[$i]%%|*}"
    hint="${MENU_ITEMS[$i]##*|}"
    if [ "${MENU_KEYS[$i]}" = "network" ]; then
      if [ "$NET" = testnet ]; then hint="-> mainnet"; else hint="-> testnet"; fi
    fi
    out+=$(menu_row "$i" "$label" "[$hint]" "$SEL")
  done
  out+=$(printf '%s├%s┤%s\n' "$C_DIM" "$(hline "$W")" "$C_RST")

  case "$MSG_KIND" in
    ok)   out+=$(msg_row "$MSG" "$C_G") ;;
    err)  out+=$(msg_row "$MSG" "$C_R") ;;
    warn) out+=$(msg_row "$MSG" "$C_Y") ;;
    *)    out+=$(msg_row "$MSG" "$C_DIM") ;;
  esac
  out+=$(printf '%s╰%s╯%s\n' "$C_DIM" "$(hline "$W")" "$C_RST")
  out+=$'\n'
  out+=$(printf '%s  %s  ·  %s ms  ·  %s  ·  arrow keys + enter  ·  q quit%s\n' \
         "$C_DIM" "$RPC" "${LATENCY_MS:-?}" "$(short_addr "$W_ADDR")" "$C_RST")

  printf '%s' "$out"
}

set_msg() { MSG="$1"; MSG_KIND="${2:-info}"; }

# ------------------------------------------------------------- input reading --
KEY=""
read_key() {
  local a b
  KEY=""
  if ! IFS= read -rsn1 KEY; then KEY="quit"; return; fi
  if [ "$KEY" = $'\033' ]; then
    IFS= read -rsn1 -t 1 a || { KEY="esc"; return; }
    IFS= read -rsn1 -t 1 b || { KEY="esc"; return; }
    case "$a$b" in
      '[A') KEY="up" ;; '[B') KEY="down" ;;
      '[C') KEY="right" ;; '[D') KEY="left" ;;
      *)    KEY="esc" ;;
    esac
  elif [ -z "$KEY" ]; then
    KEY="enter"
  fi
}

pause_enter() {
  printf '\n%s  press enter to go back%s ' "$C_DIM" "$C_RST"
  IFS= read -r _ || true
}

clear_screen() { printf '\033[H\033[2J'; }

# ------------------------------------------------------------------ screens --
screen_send() {
  clear_screen
  printf '%s  SEND MON  ·  %s%s\n\n' "$C_B$C_W" "$NET_LABEL" "$C_RST"

  if [ -z "$W_ADDR" ]; then
    printf '%s  no address set - use "w" first%s\n' "$C_R" "$C_RST"; pause_enter; return
  fi
  if ! has_signer; then
    printf '%s  no signing key loaded - only a watch address is set.%s\n' "$C_Y" "$C_RST"
    printf '  load a key first (menu "w"), or sign elsewhere.\n'; pause_enter; return
  fi

  # unlock the keystore up front: keeps the password prompt under our control
  # and proves which address will actually sign.
  local pw=""
  if [ -z "$PK_MEM" ]; then
    printf '  keystore password for "%s" (hidden): ' "$ACCOUNT"
    IFS= read -rs pw || true; printf '\n'
    local unlocked
    unlocked=$(cast wallet address --account "$ACCOUNT" --password "$pw" 2>/dev/null)
    if ! is_addr "$unlocked"; then
      printf '\n%s  wrong password or unreadable keystore "%s"%s\n' "$C_R" "$ACCOUNT" "$C_RST"
      pause_enter; return
    fi
    W_ADDR="$unlocked"
  fi

  printf '  from  %s  [%s]\n\n' "$W_ADDR" "$(wallet_kind)"
  printf '  to    '
  local to; IFS= read -r to || return
  to="$(printf '%s' "$to" | tr -d '[:space:]')"
  if ! is_addr "$to"; then printf '\n%s  not a valid 0x address%s\n' "$C_R" "$C_RST"; pause_enter; return; fi
  to=$(cast to-check-sum-address "$to" 2>/dev/null || printf '%s' "$to")

  printf '  amount (MON)  '
  local amt; IFS= read -r amt || return
  amt="$(printf '%s' "$amt" | tr -d '[:space:]')"
  if ! is_amount "$amt"; then printf '\n%s  not a valid amount%s\n' "$C_R" "$C_RST"; pause_enter; return; fi

  printf '\n  %sestimating gas...%s\r' "$C_DIM" "$C_RST"
  local gas
  gas=$(cast estimate "$to" --value "${amt}ether" --rpc-url "$RPC" 2>/dev/null)
  case "$gas" in ''|*[!0-9]*) gas=21000 ;; esac
  gas=$(( gas + gas / 10 ))   # 10% headroom, Monad charges on gas_limit

  local gp fee total
  [ -n "$GAS_PRICE_WEI" ] || fetch_stats >/dev/null 2>&1
  gp="${GAS_PRICE_WEI:-0}"
  fee=$(mul_mon "$gas" "$gp")
  total=$(sum_mon "$amt" "$fee")
  local r; r=$(idr_of "$total")

  local gp_gwei need_wei short=0
  gp_gwei=$(awk -v g="$gp" 'BEGIN{ printf "%.2f", g/1e9 }')
  need_wei=$(cast to-wei "$total" ether 2>/dev/null)
  if [ -n "$need_wei" ] && [ -n "$BAL_WEI" ] && \
     awk -v a="$BAL_WEI" -v b="$need_wei" 'BEGIN{ exit !(a+0 < b+0) }'; then
    short=1
  fi

  clear_screen
  printf '%s  CONFIRM TRANSFER  ·  %s%s\n\n' "$C_B$C_W" "$NET_LABEL" "$C_RST"
  printf '  from    %s\n' "$W_ADDR"
  printf '  to      %s\n' "$to"
  printf '  amount  %s%s MON%s\n' "$C_G$C_B" "$amt" "$C_RST"
  [ -n "$r" ] && printf '  value   ≈ Rp %s\n' "$(commify "$r")"
  printf '  gas     %s x %s gwei = %s MON\n' "$gas" "$gp_gwei" "$fee"
  printf '  total   %s MON\n' "$total"
  printf '  balance %s MON\n' "$(fmt_mon "${BAL_WEI:-0}")"
  printf '  chain   %s (id %s)\n\n' "$NET_LABEL" "$CHAIN_ID"

  if [ "$short" = "1" ]; then
    printf '%s  balance is short: this wallet cannot pay amount + gas.%s\n' "$C_R" "$C_RST"
    printf '  top up on %s, then retry.\n' "$NET_LABEL"
    set_msg "send aborted - insufficient balance" err
    pause_enter; return
  fi

  printf '%s  type SEND to broadcast, anything else cancels:%s ' "$C_Y" "$C_RST"
  local ok; IFS= read -r ok || return
  if [ "$ok" != "SEND" ]; then printf '\n%s  cancelled%s\n' "$C_DIM" "$C_RST"; pause_enter; return; fi

  printf '\n  %sbroadcasting...%s\n' "$C_DIM" "$C_RST"
  local signer=(--private-key "$PK_MEM")
  [ -z "$PK_MEM" ] && signer=(--account "$ACCOUNT" --password "$pw")

  # --async prints the hash only, so the receipt is fetched separately: no
  # dependency on the shape of `cast send --json` output.
  local out hash
  out=$(cast send "$to" --value "${amt}ether" --gas-limit "$gas" \
        "${signer[@]}" --rpc-url "$RPC" --async 2>&1)
  hash=$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{64}' | head -1)

  clear_screen
  if [ -z "$hash" ]; then
    local reason
    reason=$(printf '%s' "$out" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)
    [ -z "$reason" ] && reason=$(printf '%s' "$out" | grep -vE '^[[:space:]]*$' | head -1)
    printf '%s  transaction failed%s\n\n' "$C_R" "$C_RST"
    printf '  %s\n\n' "$reason"
    case "$reason" in
      *insufficient*|*balance*) printf '  %stop up on %s and retry.%s\n' "$C_DIM" "$NET_LABEL" "$C_RST" ;;
    esac
    set_msg "send failed: ${reason:0:56}" err
    pause_enter; return
  fi

  # Monad finalises in about a second; poll briefly so the receipt is shown.
  local rec="" i=0
  while [ "$i" -lt 20 ]; do
    rec=$(cast receipt "$hash" --rpc-url "$RPC" 2>/dev/null)
    [ -n "$rec" ] && break
    i=$(( i + 1 )); sleep 1
  done

  clear_screen
  local st gasused
  st=$(printf '%s' "$rec" | awk '$1=="status"{print $2" "$3}' | head -1)
  gasused=$(printf '%s' "$rec" | awk '$1=="gasUsed"{print $2}' | head -1)
  printf '%s  SENT%s\n\n' "$C_G$C_B" "$C_RST"
  printf '  tx      %s\n' "$hash"
  printf '  status  %s\n' "${st:-pending - check the explorer}"
  [ -n "$gasused" ] && printf '  gasUsed %s\n' "$(commify "$gasused")"
  printf '  amount  %s MON -> %s\n' "$amt" "$to"
  printf '  network %s\n' "$NET_LABEL"
  printf '\n  %s%s/tx/%s%s\n' "$C_C" "$EXPLORER" "$hash" "$C_RST"
  set_msg "tx $(short_addr "$hash") sent on $NET" ok
  save_state
  pause_enter
}

screen_wallet() {
  clear_screen
  printf '%s  WALLET%s\n\n' "$C_B$C_W" "$C_RST"
  printf '  current  %s\n' "${W_ADDR:-<none>}"
  printf '  signer   %s\n\n' "$(wallet_kind)"
  printf '  1) set watch address\n'
  printf '  2) load private key (memory only, never written to disk)\n'
  printf '  3) use foundry keystore account (~/.foundry/keystores)\n'
  printf '  4) create a new burner key\n'
  printf '  5) forget loaded key / account\n'
  printf '  6) back\n\n'
  printf '  choice: '
  local ch; IFS= read -r ch || return

  case "$ch" in
    1)
      if [ -n "$PK_MEM" ]; then
        set_msg "a key is loaded - forget it (option 5) before watching another address" err
        pause_enter; return
      fi
      printf '\n  address: '
      local a; IFS= read -r a || return
      a="$(printf '%s' "$a" | tr -d '[:space:]')"
      if is_addr "$a"; then
        W_ADDR=$(cast to-check-sum-address "$a" 2>/dev/null || printf '%s' "$a")
        clear_stats; fetch_stats >/dev/null 2>&1
        save_state; set_msg "watch address set to $(short_addr "$W_ADDR")" ok
      else
        set_msg "invalid address" err
      fi
      ;;
    2)
      printf '\n  private key (input hidden): '
      local k; IFS= read -rs k || return; printf '\n'
      case "$k" in
        0x*) : ;;
        *) set_msg "private key must start with 0x" err; pause_enter; return ;;
      esac
      local a2
      if a2=$(cast wallet address --private-key "$k" 2>/dev/null); then
        PK_MEM="$k"; ACCOUNT=""; W_ADDR="$a2"; clear_stats; fetch_stats >/dev/null 2>&1
        save_state
        set_msg "key loaded for $(short_addr "$a2") - memory only" warn
      else
        set_msg "could not derive an address from that key" err
      fi
      ;;
    3)
      printf '\n  keystore name: '
      local n; IFS= read -r n || return
      n="$(printf '%s' "$n" | tr -d '[:space:]')"
      if [ -z "$n" ]; then set_msg "no account name given" err; pause_enter; return; fi
      if [ ! -e "$HOME/.foundry/keystores/$n" ]; then
        set_msg "no keystore named '$n' - create one with: cast wallet import $n --interactive" err
        pause_enter; return
      fi
      ACCOUNT="$n"; PK_MEM=""
      printf '\n  keystore password (hidden, leave empty to skip address lookup): '
      local p; IFS= read -rs p || return; printf '\n'
      if [ -n "$p" ]; then
        local a3
        a3=$(cast wallet address --account "$n" --password "$p" 2>/dev/null || true)
        if is_addr "$a3"; then W_ADDR="$a3"; fi
      fi
      if ! is_addr "${W_ADDR:-}"; then
        printf '\n  address of that account (0x..., blank to fill later): '
        local a4; IFS= read -r a4 || true
        a4="$(printf '%s' "$a4" | tr -d '[:space:]')"
        is_addr "$a4" && W_ADDR=$(cast to-check-sum-address "$a4" 2>/dev/null || printf '%s' "$a4")
      fi
      clear_stats; fetch_stats >/dev/null 2>&1
      save_state; set_msg "keystore account '$n' active" ok
      ;;
    4)
      clear_screen
      printf '%s  NEW BURNER KEY%s\n\n' "$C_B$C_W" "$C_RST"
      printf '  %sburner only - send testnet MON here, do not reuse for value%s\n\n' "$C_Y" "$C_RST"
      local kv baddr bkey
      kv=$(cast wallet new 2>&1)
      baddr=$(printf '%s' "$kv" | sed -n 's/^Address:[[:space:]]*//p' | head -1)
      bkey=$(printf '%s' "$kv" | sed -n 's/^Private key:[[:space:]]*//p' | head -1)
      if [ -z "$baddr" ]; then
        printf '%s  could not create a key%s\n\n%s\n' "$C_R" "$C_RST" "$kv"
        pause_enter; return
      fi
      printf '  address      %s%s%s\n' "$C_W$C_B" "$baddr" "$C_RST"
      printf '  private key  %s%s%s\n\n' "$C_Y" "$bkey" "$C_RST"
      printf '  print this once, then forget it. load it with:\n'
      printf '    %scast wallet import burner --interactive%s\n' "$C_DIM" "$C_RST"
      printf '  or in this tool: w -> 2 (memory only)\n'
      pause_enter
      ;;
    5)
      PK_MEM=""; ACCOUNT=""
      set_msg "key/account cleared - watch only" warn
      ;;
    *) : ;;
  esac
  save_state
}

screen_erc20() {
  clear_screen
  printf '%s  ERC20 BALANCE%s\n\n' "$C_B$C_W" "$C_RST"
  [ -z "$W_ADDR" ] && { printf '  no address set\n'; pause_enter; return; }
  printf '  holder  %s\n\n' "$W_ADDR"
  printf '  token address [%s]: ' "${TOKEN:-none}"
  local t; IFS= read -r t || return
  t="$(printf '%s' "$t" | tr -d '[:space:]')"
  [ -z "$t" ] && t="$TOKEN"
  is_addr "$t" || { printf '\n%s  invalid token address%s\n' "$C_R" "$C_RST"; pause_enter; return; }
  TOKEN="$t"; save_state

  printf '  decimals [18]: '
  local dec; IFS= read -r dec || return
  dec="$(printf '%s' "$dec" | tr -d '[:space:]')"
  [ -z "$dec" ] && dec=18
  case "$dec" in ''|*[!0-9]*) dec=18 ;; esac

  printf '\n  %sreading...%s\r' "$C_DIM" "$C_RST"
  local sym="" raw
  sym=$(cast call "$t" "symbol()(string)" --rpc-url "$RPC" 2>/dev/null || true)
  raw=$(cast call "$t" "balanceOf(address)(uint256)" "$W_ADDR" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
  clear_screen
  if [ -z "$raw" ]; then
    printf '%s  no balanceOf() answer - is %s a token on %s?%s\n' "$C_R" "$(short_addr "$t")" "$NET_LABEL" "$C_RST"
    pause_enter; return
  fi
  printf '%s  ERC20%s\n\n' "$C_B$C_W" "$C_RST"
  printf '  token   %s %s\n' "${sym:-?}" "$t"
  printf '  holder  %s\n' "$W_ADDR"
  printf '  balance %s%s%s (raw %s, %s decimals)\n' "$C_G$C_B" \
    "$(awk -v v="$raw" -v d="$dec" 'BEGIN{ printf "%.6f", v/(10^d) }')" "$C_RST" "$raw" "$dec"
  printf '  network %s\n' "$NET_LABEL"
  pause_enter
}

screen_receipt() {
  clear_screen
  printf '%s  TRANSACTION%s\n\n' "$C_B$C_W" "$C_RST"
  printf '  hash: '
  local h; IFS= read -r h || return
  h="$(printf '%s' "$h" | tr -d '[:space:]')"
  case "$h" in 0x*) ;; *) printf '\n%s  not a tx hash%s\n' "$C_R" "$C_RST"; pause_enter; return ;; esac

  printf '\n  %slooking up...%s\r' "$C_DIM" "$C_RST"
  local js
  js=$(cast receipt "$h" --rpc-url "$RPC" --json 2>&1)
  clear_screen
  if ! printf '%s' "$js" | grep -q '"blockNumber"'; then
    printf '%s  not found on %s%s\n\n' "$C_R" "$NET_LABEL" "$C_RST"
    printf '%s\n' "$js" | sed -n '1,6p'
    pause_enter; return
  fi
  local raw_st raw_blk raw_gas raw_val st blk gasused val
  raw_st=$(printf '%s' "$js" | jq -r '.status // "?"' 2>/dev/null)
  raw_blk=$(printf '%s' "$js" | jq -r '.blockNumber // "?"' 2>/dev/null)
  raw_gas=$(printf '%s' "$js" | jq -r '.gasUsed // "?"' 2>/dev/null)
  raw_val=$(printf '%s' "$js" | jq -r '.value // "0x0"' 2>/dev/null)
  case "$raw_st" in 0x1) st="success" ;; 0x0) st="failed (reverted)" ;; *) st="${raw_st}" ;; esac
  blk=$(cast to-dec "$raw_blk" 2>/dev/null || printf '%s' "$raw_blk")
  gasused=$(cast to-dec "$raw_gas" 2>/dev/null || printf '%s' "$raw_gas")
  val_wei=$(cast to-dec "$raw_val" 2>/dev/null)
  if [ -n "$val_wei" ]; then val="$(fmt_mon "$val_wei") MON"; else val="$raw_val"; fi

  printf '%s  TRANSACTION%s\n\n' "$C_B$C_W" "$C_RST"
  printf '  hash    %s\n' "$h"
  printf '  status  %s\n' "$st"
  printf '  block   %s\n' "$(commify "$blk")"
  printf '  from    %s\n' "$(printf '%s' "$js" | jq -r '.from // "?"' 2>/dev/null)"
  printf '  to      %s\n' "$(printf '%s' "$js" | jq -r '.to // "(contract creation)"' 2>/dev/null)"
  printf '  value   %s\n' "$val"
  printf '  gasUsed %s\n' "$(commify "$gasused")"
  printf '\n  %s%s/tx/%s%s\n' "$C_C" "$EXPLORER" "$h" "$C_RST"
  pause_enter
}

screen_help() {
  clear_screen
  cat <<EOF
${C_B}${C_W}  ASAP WALLET $VERSION${C_RST}

  A basic wallet for the ASAP demo: balance, send MON, switch networks.

${C_B}  Networks${C_RST}
    testnet   chain 10143   https://testnet-rpc.monad.xyz   faucet: faucet.monad.xyz
    mainnet   chain 143     https://rpc.monad.xyz           real MON, real money

${C_B}  Signing${C_RST}
    watch only    read balances for any address, cannot send
    raw key       held in this process memory only, never written to disk.
                  It is passed to \`cast\` as an argument, so it appears in
                  \`ps\` for that user while the transaction is signed.
    keystore      ~/.foundry/keystores/<name>, encrypted at rest:
                      cast wallet import dev --interactive
                  then pick option 3 in the wallet screen. The password is
                  asked for when the transfer is confirmed.

  ${C_Y}Never paste a mainnet key that holds more than you can afford to lose.${C_RST}
  ${C_Y}Use a burner for testnet; move value to a keystore.${C_RST}

${C_B}  Environment${C_RST}
    ADDRESS / PRIVATE_KEY   defaults on start (PRIVATE_KEY is memory only)
    MON_IDR=15000           show IDR estimates at this rate
    NO_COLOR=1              plain output

${C_B}  CLI${C_RST}
    --net mainnet   --addr 0x...   --account dev   --key 0x...   --once

  State (network, watch address, last token) is kept in
  ${STATE_DIR}/state - never a private key.
EOF
  pause_enter
}

open_explorer() {
  local url="$EXPLORER"
  if [ -n "$W_ADDR" ]; then url="$EXPLORER/address/$W_ADDR"; fi
  printf '\n  %s\n' "$url"
  if command -v open >/dev/null 2>&1; then open "$url" 2>/dev/null && set_msg "opened $url" ok
  else set_msg "$url" info; fi
  sleep 1
}

copy_address() {
  if [ -z "$W_ADDR" ]; then set_msg "no address to copy" err; return; fi
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$W_ADDR" | pbcopy && set_msg "copied $W_ADDR" ok
  else
    set_msg "pbcopy not available: $W_ADDR" warn
  fi
}

run_action() {
  case "${MENU_KEYS[$1]}" in
    refresh)
      fetch_stats && set_msg "refreshed from $NET" ok || set_msg "${STATS_ERR:-refresh failed}" err
      ;;
    send)     screen_send ;;
    network)
      local prev="$NET"
      toggle_network
      fetch_stats >/dev/null 2>&1
      if [ "$NET" = "mainnet" ]; then
        set_msg "network: $prev -> MAINNET - this is real MON" warn
      else
        set_msg "network: $prev -> testnet" info
      fi
      ;;
    wallet)   screen_wallet ;;
    erc20)    screen_erc20 ;;
    receipt)  screen_receipt ;;
    explorer) open_explorer ;;
    copy)     copy_address ;;
    help)     screen_help ;;
    quit)     return 1 ;;
  esac
  return 0
}

# ---------------------------------------------------------------- boot logic --
ensure_identity() {
  if [ -n "$PK_MEM" ]; then
    local a
    if a=$(derive_addr_from_pk); then W_ADDR="$a"; fi
  fi
  [ -n "$CLI_ADDR" ] && W_ADDR="$CLI_ADDR"

  if [ "$ASK_KEY" = "1" ] && [ -z "$PK_MEM" ]; then
    printf 'private key (hidden): '
    local k; IFS= read -rs k || true; printf '\n'
    if [ -n "$k" ]; then
      PK_MEM="$k"
      local a2
      a2=$(derive_addr_from_pk) || { echo "invalid private key" >&2; exit 2; }
      W_ADDR="$a2"
    fi
  fi

  if [ -z "$W_ADDR" ] && [ "$ONCE" = "0" ]; then
    printf 'watch address (0x... , empty to skip): '
    local a3; IFS= read -r a3 || true
    a3="$(printf '%s' "$a3" | tr -d '[:space:]')"
    is_addr "$a3" && W_ADDR=$(cast to-check-sum-address "$a3" 2>/dev/null || printf '%s' "$a3")
  fi
  save_state
}

once_frame() {
  [ -n "$W_ADDR" ] || { echo "no address (--addr 0x...)" >&2; exit 2; }
  STATS_ERR=""
  fetch_stats
  printf 'network   %s (%s)\n' "$NET_LABEL" "$CHAIN_ID"
  printf 'rpc       %s\n' "$RPC"
  printf 'address   %s\n' "$W_ADDR"
  printf 'signer    %s\n' "$(wallet_kind)"
  if [ -n "$STATS_ERR" ]; then
    printf 'error     %s\n' "$STATS_ERR"
    exit 1
  fi
  printf 'balance   %s MON\n' "$(fmt_mon "$BAL_WEI")"
  printf 'block     %s\n' "$BLOCK_NO"
  printf 'nonce     %s\n' "$NONCE"
  printf 'gas       %s gwei\n' "$(awk -v g="$GAS_PRICE_WEI" 'BEGIN{ printf "%.2f", g/1e9 }')"
  local r; r=$(idr_of "$(fmt_mon "$BAL_WEI" | tr -d ',')")
  [ -n "$r" ] && printf 'value_idr Rp %s\n' "$(commify "$r")"
  printf 'explorer  %s/address/%s\n' "$EXPLORER" "$W_ADDR"
}

main_loop() {
  tput smcup 2>/dev/null; tput civis 2>/dev/null
  trap 'tput cnorm 2>/dev/null; tput rmcup 2>/dev/null; exit 130' INT TERM
  trap 'tput cnorm 2>/dev/null; tput rmcup 2>/dev/null' EXIT

  local n=${#MENU_ITEMS[@]} now
  while :; do
    now=$(date +%s)
    if [ -n "$W_ADDR" ] && [ "$CHECKED_EPOCH" -gt 0 ] && [ $(( now - CHECKED_EPOCH )) -ge 30 ]; then
      fetch_stats >/dev/null 2>&1
    fi
    draw_main
    read_key
    case "$KEY" in
      up|k)   SEL=$(( (SEL - 1 + n) % n )) ;;
      down|j) SEL=$(( (SEL + 1) % n )) ;;
      enter)  run_action "$SEL" || break ;;
      refresh|r) run_action 0 ;;
      s)      screen_send ;;
      n)      run_action 2 ;;
      w)      screen_wallet ;;
      t)      screen_erc20 ;;
      x)      screen_receipt ;;
      o)      open_explorer; fetch_stats >/dev/null 2>&1 ;;
      c)      copy_address ;;
      h|'?')  screen_help ;;
      q|quit) break ;;
      *) : ;;
    esac
  done
  tput cnorm 2>/dev/null; tput rmcup 2>/dev/null
  trap - EXIT
  printf '\nbye.\n'
}

# -------------------------------------------------------------------- start --
load_state
set_network "$NET"
ensure_identity

if [ "$ONCE" = "1" ]; then
  once_frame
  exit $?
fi

fetch_stats >/dev/null 2>&1
set_msg "ready - press r to refresh, q to quit"
main_loop
