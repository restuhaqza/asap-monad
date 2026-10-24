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
CUR_SIZE=""
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
# `stty size` reads the tty on stdin; `tput cols` is only a fallback because on
# macOS it answers 80 whenever stderr is redirected (which this UI does).
term_cols() {
  local c
  c=$(stty size 2>/dev/null | awk '{print $2}')
  case "$c" in ''|*[!0-9]*) c=$(tput cols 2>/dev/null) ;; esac
  case "$c" in ''|*[!0-9]*) c=80 ;; esac
  [ "$c" -lt 20 ] && c=20
  printf '%s' "$c"
}

term_rows() {
  local r
  r=$(stty size 2>/dev/null | awk '{print $1}')
  case "$r" in ''|*[!0-9]*) r=$(tput lines 2>/dev/null) ;; esac
  case "$r" in ''|*[!0-9]*) r=24 ;; esac
  [ "$r" -lt 8 ] && r=8
  printf '%s' "$r"
}

# content width inside the box: terminal width minus the two borders,
# capped so the panel does not stretch across an ultrawide terminal
inner_width() {
  local w
  w=$(( $(term_cols) - 2 ))
  [ "$w" -gt 96 ] && w=96
  printf '%s' "$w"
}

# truncate to a column budget - nothing in this UI is allowed to wrap
fit() {
  local s="$1" w="$2"
  [ "$w" -lt 1 ] && { printf ''; return; }
  if [ ${#s} -le "$w" ]; then printf '%s' "$s"; return; fi
  if [ "$w" -le 2 ]; then printf '%s' "${s:0:$w}"; return; fi
  printf '%s..' "${s:0:$(( w - 2 ))}"
}

hline() {
  local n="$1" s=""
  while [ ${#s} -lt "$n" ]; do s="${s}─"; done
  printf '%s' "$s"
}

# Frame buffer. `out+=$(printf ...)` would eat the trailing newline and glue
# every row into one long line, so rows are appended through emit() instead.
OUT=""
SEG=""
emit() { OUT+="$1"; OUT+=$'\n'; }
line() { printf -v SEG "$@"; emit "$SEG"; }

# row <plain-text> [color]
row() {
  local plain col pad
  plain=$(fit "$1" $(( W - 2 )))
  col="${2:-}"
  pad=$(( W - 1 - ${#plain} ))
  [ "$pad" -lt 0 ] && pad=0
  printf -v SEG '%s│%s %s%s%*s%s│%s' "$C_DIM" "$col" "$plain" "$C_RST" "$pad" "" "$C_DIM" "$C_RST"
  emit "$SEG"
}

menu_row() {
  local idx="$1" label="$2" hint="$3" cur="$4"
  local mark=" " mark_c="" lbl_c="" avail label_w lshort padded plain colored pad
  if [ "$cur" = "$idx" ]; then mark=">"; mark_c="$C_C$C_B"; lbl_c="$C_B"; fi
  avail=$(( W - 4 ))
  # hints are the first thing to go when the terminal is narrow
  if [ -n "$hint" ] && [ $(( avail - ${#hint} - 2 )) -ge 18 ]; then
    label_w=$(( avail - ${#hint} - 2 ))
  else
    hint=""
    label_w=$avail
  fi
  if [ "$label_w" -lt ${#label} ] && [ -n "${MENU_SHORT[$idx]:-}" ]; then
    label="${MENU_SHORT[$idx]}"
  fi
  lshort=$(fit "$label" "$label_w")
  padded=$(printf "%-${label_w}s" "$lshort")
  if [ -n "$hint" ]; then
    plain=$(printf '%s %s  %s' "$mark" "$padded" "$hint")
    colored=$(printf '%s%s%s %s%s%s  %s%s%s' "$mark_c" "$mark" "$C_RST" \
              "$lbl_c" "$padded" "$C_RST" "$C_DIM" "$hint" "$C_RST")
  else
    plain=$(printf '%s %s' "$mark" "$padded")
    colored=$(printf '%s%s%s %s%s%s' "$mark_c" "$mark" "$C_RST" \
              "$lbl_c" "$padded" "$C_RST")
  fi
  pad=$(( W - 1 - ${#plain} ))
  [ "$pad" -lt 0 ] && pad=0
  printf -v SEG '%s│%s %s%*s%s│%s' "$C_DIM" "$colored" "" "$pad" "" "$C_DIM" "$C_RST"
  emit "$SEG"
}

msg_row() {
  local plain col pad
  plain=$(fit " $1" $(( W - 2 )))
  col="${2:-}"
  pad=$(( W - 1 - ${#plain} ))
  [ "$pad" -lt 0 ] && pad=0
  printf -v SEG '%s│%s %s%s%*s%s│%s' "$C_DIM" "$col" "$plain" "$C_RST" "$pad" "" "$C_DIM" "$C_RST"
  emit "$SEG"
}

# pline <text> [color]: prose on a detail screen, wrapped to the terminal
pline() {
  local t="$1" col="${2:-}" w
  w=$(inner_width)
  printf '%s' "$t" | fold -s -w $(( w - 2 )) | sed 's/^/  /' | while IFS= read -r l; do
    printf '%s%s%s\n' "$col" "$l" "$C_RST"
  done
}

# `label value` for detail screens: a long value gets its own line instead of
# being cut in half or wrapping
kv() {
  local label="$1" value="$2" w
  w=$(inner_width)
  if [ $(( 10 + ${#value} )) -le "$w" ]; then
    printf '  %-8s %s\n' "$label" "$value"          # label and value on one line
  elif [ $(( 2 + ${#value} )) -le "$w" ]; then
    printf '  %s\n  %s\n' "$label" "$value"        # value on its own indented line
  elif [ ${#value} -le "$w" ]; then
    printf '  %s\n%s\n' "$label" "$value"          # edge to edge, still complete
  else
    printf '  %s\n  %s\n' "$label" "$(fit "$value" $(( w - 2 )))"
  fi
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
MENU_SHORT=(
  "Refresh" "Send MON" "Network" "Wallet"
  "ERC20" "Receipt" "Explorer" "Copy address"
  "Help" "Quit"
)
MENU_KEYS=(refresh send network wallet erc20 receipt explorer copy help quit)
SEL=0

draw_main() {
  local W i label hint nkeys rows pad title right
  W=$(inner_width)
  rows=$(term_rows)
  CUR_SIZE="${W}x${rows}"
  OUT=$'\033[H\033[2J'

  title=" ASAP WALLET"
  if [ "$NET" = "mainnet" ]; then right="MAINNET 143  "; else right="TESTNET 10143  "; fi
  if [ $(( ${#title} + ${#right} + 2 )) -gt "$W" ]; then
    title=" ASAP"
    if [ "$NET" = "mainnet" ]; then right="MAINNET "; else right="TESTNET "; fi
  fi

  line '%s╭%s╮%s' "$C_DIM" "$(hline "$W")" "$C_RST"
  pad=$(( W - ${#title} - ${#right} ))
  [ "$pad" -lt 0 ] && pad=0
  line '%s│%s%s%s%s%*s%s%s│%s' "$C_DIM" "$C_B$C_W" "$title" "$C_RST" "" "$pad" "" \
       "$([ "$NET" = mainnet ] && printf '%s' "$C_M" || printf '%s' "$C_C")" "$right" "$C_RST"
  line '%s├%s┤%s' "$C_DIM" "$(hline "$W")" "$C_RST"

  # each row is composed from the widest variant that still fits: whole values
  # are dropped, never sliced in half
  local budget=$(( W - 12 ))
  local bal_line idr_only=""
  if [ -n "$STATS_ERR" ]; then
    bal_line="balance   ! $STATS_ERR"
  elif [ -n "$BAL_WEI" ]; then
    bal_line="balance   $(fmt_mon "$BAL_WEI") MON"
    if [ -n "$MON_IDR" ]; then
      local rp; rp=$(idr_of "$(fmt_mon "$BAL_WEI" | tr -d ',')")
      if [ -n "$rp" ]; then
        if [ $(( ${#bal_line} + 13 + ${#rp} )) -le "$budget" ]; then
          bal_line="$bal_line   (≈ Rp $(commify "$rp"))"
        else
          idr_only="≈ Rp $(commify "$rp")"
        fi
      fi
    fi
  else
    bal_line="balance   - press r to load -"
  fi
  row "$bal_line" "$C_G"

  local kind kind_short addr_line
  kind=$(wallet_kind)
  case "$kind" in
    "watch only")    kind_short="watch" ;;
    "key in memory") kind_short="key" ;;
    keystore:*)      kind_short="keystore" ;;
    *)               kind_short="$kind" ;;
  esac
  addr_line="address   $(short_addr "$W_ADDR")   [$kind]"
  [ ${#addr_line} -gt $(( W - 2 )) ] && addr_line="address   $(short_addr "$W_ADDR")   [$kind_short]"
  [ ${#addr_line} -gt $(( W - 2 )) ] && addr_line="address   $(short_addr "$W_ADDR")"
  row "$addr_line" "$C_W"
  if [ -n "$idr_only" ] && [ "$rows" -ge 22 ]; then
    row "          $idr_only" "$C_DIM"
  fi

  if [ -n "$BLOCK_NO" ] && [ -n "$GAS_PRICE_WEI" ]; then
    local gas_gwei fee ln p
    gas_gwei=$(awk -v g="$GAS_PRICE_WEI" 'BEGIN{ printf "%.2f", g/1e9 }')
    fee=$(mul_mon 21000 "$GAS_PRICE_WEI")
    ln=""
    for p in "block $(commify "$BLOCK_NO")" "gas ${gas_gwei} gwei" "nonce ${NONCE:-?}"; do
      if [ -z "$ln" ]; then ln="$p"
      elif [ $(( ${#ln} + 3 + ${#p} )) -le "$budget" ]; then ln="$ln · $p"; fi
    done
    row "chain     $ln"

    # the fee line is the first casualty on a short terminal
    if [ "$rows" -ge 22 ]; then
      ln="transfer fee ≈ $fee MON"
      [ $(( ${#ln} + 10 )) -gt "$budget" ] && ln="fee ≈ $fee MON"
      if [ $(( ${#ln} + 10 )) -gt "$budget" ]; then
        ln="fee ≈ $(awk -v f="$fee" 'BEGIN{ printf "%.4f", f }') MON"
      fi
      if [ -n "${CHECKED_AT:-}" ] && [ $(( ${#ln} + 11 + ${#CHECKED_AT} )) -le "$budget" ]; then
        ln="$ln · checked $CHECKED_AT"
      fi
      row "          $ln" "$C_DIM"
    fi
  else
    row "chain     - press r to load -" "$C_DIM"
  fi

  line '%s├%s┤%s' "$C_DIM" "$(hline "$W")" "$C_RST"
  nkeys=${#MENU_ITEMS[@]}
  for (( i=0; i<nkeys; i++ )); do
    label="${MENU_ITEMS[$i]%%|*}"
    hint="${MENU_ITEMS[$i]##*|}"
    if [ "${MENU_KEYS[$i]}" = "network" ]; then
      if [ "$NET" = testnet ]; then hint="-> mainnet"; else hint="-> testnet"; fi
    fi
    menu_row "$i" "$label" "[$hint]" "$SEL"
  done
  line '%s├%s┤%s' "$C_DIM" "$(hline "$W")" "$C_RST"

  case "$MSG_KIND" in
    ok)   msg_row "$MSG" "$C_G" ;;
    err)  msg_row "$MSG" "$C_R" ;;
    warn) msg_row "$MSG" "$C_Y" ;;
    *)    msg_row "$MSG" "$C_DIM" ;;
  esac
  line '%s╰%s╯%s' "$C_DIM" "$(hline "$W")" "$C_RST"
  emit ""

  local host="${RPC#*://}" f
  if [ "$(term_cols)" -lt 72 ]; then
    f="  $(fit "$host" $(( W - 14 )))  ·  ${LATENCY_MS:-?} ms"
    line '%s%s%s' "$C_DIM" "$(fit "$f" "$W")" "$C_RST"
    f="  $(short_addr "$W_ADDR")  ·  q quit"
    line '%s%s%s' "$C_DIM" "$(fit "$f" "$W")" "$C_RST"
  else
    f="  $host  ·  ${LATENCY_MS:-?} ms  ·  $(short_addr "$W_ADDR")  ·  arrows + enter  ·  q quit"
    line '%s%s%s' "$C_DIM" "$(fit "$f" "$W")" "$C_RST"
  fi

  printf '%s' "$OUT"
}

set_msg() { MSG="$1"; MSG_KIND="${2:-info}"; }

# ------------------------------------------------------------- input reading --
KEY=""
read_key() {
  local a b rc
  KEY=""
  # bash 3.2 has no fractional timeout and reports a timeout as rc=1, so the
  # loop wakes up once a second and re-checks the window size instead of
  # blocking forever on read. rc=0 with no byte is the enter key.
  IFS= read -rsn1 -t 1 KEY; rc=$?
  if [ "$rc" -ne 0 ]; then KEY="tick"; return; fi
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
    pline "no address set - use \"w\" first" "$C_R"; pause_enter; return
  fi
  if ! has_signer; then
    pline "no signing key loaded - only a watch address is set." "$C_Y"
    pline "load a key first (menu \"w\"), or sign elsewhere."
    pause_enter; return
  fi

  local pw=""
  if [ -z "$PK_MEM" ]; then
    printf '  keystore password for "%s" (hidden): ' "$ACCOUNT"
    IFS= read -rs pw || true; printf '\n'
    local unlocked
    unlocked=$(cast wallet address --account "$ACCOUNT" --password "$pw" 2>/dev/null)
    if ! is_addr "$unlocked"; then
      pline "wrong password or unreadable keystore \"$ACCOUNT\"" "$C_R"
      pause_enter; return
    fi
    W_ADDR="$unlocked"
  fi

  kv from "$W_ADDR"
  kv signer "$(wallet_kind)"
  if [ "$(term_cols)" -lt 60 ]; then
    printf '\n  to:\n  '
  else
    printf '\n  to     '
  fi
  local to; IFS= read -r to || return
  to="$(printf '%s' "$to" | tr -d '[:space:]')"
  if ! is_addr "$to"; then
    printf '\n'; pline "not a valid 0x address" "$C_R"; pause_enter; return
  fi
  to=$(cast to-check-sum-address "$to" 2>/dev/null || printf '%s' "$to")

  if [ "$(term_cols)" -lt 60 ]; then
    printf '  amount (MON):\n  '
  else
    printf '  amount (MON)  '
  fi
  local amt; IFS= read -r amt || return
  amt="$(printf '%s' "$amt" | tr -d '[:space:]')"
  if ! is_amount "$amt"; then
    printf '\n'; pline "not a valid amount" "$C_R"; pause_enter; return
  fi

  printf '\n  %sestimating gas...%s\r' "$C_DIM" "$C_RST"
  local gas
  gas=$(cast estimate "$to" --value "${amt}ether" --rpc-url "$RPC" 2>/dev/null)
  case "$gas" in ''|*[!0-9]*) gas=21000 ;; esac
  gas=$(( gas + gas / 10 ))   # 10% headroom: Monad charges on gas_limit

  local gp fee total
  [ -n "$GAS_PRICE_WEI" ] || fetch_stats >/dev/null 2>&1
  gp="${GAS_PRICE_WEI:-0}"
  fee=$(mul_mon "$gas" "$gp")
  total=$(sum_mon "$amt" "$fee")

  local gp_gwei need_wei short=0
  gp_gwei=$(awk -v g="$gp" 'BEGIN{ printf "%.2f", g/1e9 }')
  need_wei=$(cast to-wei "$total" ether 2>/dev/null)
  if [ -n "$need_wei" ] && [ -n "$BAL_WEI" ] && \
     awk -v a="$BAL_WEI" -v b="$need_wei" 'BEGIN{ exit !(a+0 < b+0) }'; then
    short=1
  fi

  clear_screen
  printf '%s  CONFIRM TRANSFER  ·  %s%s\n\n' "$C_B$C_W" "$NET_LABEL" "$C_RST"
  kv network "$NET_LABEL (id $CHAIN_ID)"
  kv from "$W_ADDR"
  kv to "$to"
  kv amount "$amt MON"
  if [ -n "$MON_IDR" ]; then
    local rp; rp=$(idr_of "$total")
    [ -n "$rp" ] && kv "≈ rupiah" "Rp $(commify "$rp")"
  fi
  kv gas "$gas x $gp_gwei gwei = $fee MON"
  kv total "$total MON"
  kv balance "$(fmt_mon "${BAL_WEI:-0}") MON"
  printf '\n'

  if [ "$short" = "1" ]; then
    pline "balance is short: this wallet cannot pay amount + gas." "$C_R"
    pline "top up on $NET_LABEL, then retry."
    set_msg "send aborted - insufficient balance" err
    pause_enter; return
  fi

  printf '%s  type SEND to broadcast, anything else cancels:%s ' "$C_Y" "$C_RST"
  local ok; IFS= read -r ok || return
  if [ "$ok" != "SEND" ]; then
    printf '\n'; pline "cancelled" "$C_DIM"; pause_enter; return
  fi

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
    printf '%s  transaction failed%s\n\n' "$C_R$C_B" "$C_RST"
    pline "$reason"
    printf '\n'
    case "$reason" in
      *insufficient*|*balance*) pline "top up on $NET_LABEL and retry." "$C_DIM" ;;
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
  kv tx "$hash"
  kv status "${st:-pending - check the explorer}"
  [ -n "$gasused" ] && kv gasUsed "$(commify "$gasused")"
  kv amount "$amt MON"
  kv to "$to"
  kv network "$NET_LABEL"
  printf '\n  %s%s/tx/%s%s\n' "$C_C" "$EXPLORER" "$hash" "$C_RST"
  set_msg "tx $(short_addr "$hash") sent on $NET" ok
  save_state
  pause_enter
}

screen_wallet() {
  clear_screen
  printf '%s  WALLET%s\n\n' "$C_B$C_W" "$C_RST"
  kv current "${W_ADDR:-<none>}"
  kv signer "$(wallet_kind)"
  printf '\n'
  pline "1) set watch address"
  pline "2) load private key (memory only)"
  pline "3) foundry keystore account"
  pline "4) create a new burner key"
  pline "5) forget loaded key / account"
  pline "6) back"
  printf '\n  choice: '
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
  [ -z "$W_ADDR" ] && { pline "no address set"; pause_enter; return; }
  kv holder "$W_ADDR"
  printf '\n'
  printf '  token address [%s]: ' "${TOKEN:-none}"
  local t; IFS= read -r t || return
  t="$(printf '%s' "$t" | tr -d '[:space:]')"
  [ -z "$t" ] && t="$TOKEN"
  is_addr "$t" || { printf '\n'; pline "invalid token address" "$C_R"; pause_enter; return; }
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
    pline "no balanceOf() answer - is $(short_addr "$t") a token on $NET_LABEL?" "$C_R"
    pause_enter; return
  fi
  printf '%s  ERC20%s\n\n' "$C_B$C_W" "$C_RST"
  kv token "${sym:-?}"
  kv address "$t"
  kv holder "$W_ADDR"
  kv balance "$(awk -v v="$raw" -v d="$dec" 'BEGIN{ printf "%.6f", v/(10^d) }')  (raw $raw, $dec dp)"
  kv network "$NET_LABEL"
  printf '\n'
  pline "balance is coloured green above; raw is the integer the contract returns."
  pause_enter
}

screen_receipt() {
  clear_screen
  printf '%s  TRANSACTION%s\n\n' "$C_B$C_W" "$C_RST"
  if [ "$(term_cols)" -lt 76 ]; then
    printf '  hash:\n  '
  else
    printf '  hash: '
  fi
  local h; IFS= read -r h || return
  h="$(printf '%s' "$h" | tr -d '[:space:]')"
  case "$h" in 0x*) ;; *) printf '\n'; pline "not a tx hash" "$C_R"; pause_enter; return ;; esac

  printf '\n  %slooking up...%s\r' "$C_DIM" "$C_RST"
  local js
  js=$(cast receipt "$h" --rpc-url "$RPC" --json 2>&1)
  clear_screen
  if ! printf '%s' "$js" | grep -q '"blockNumber"'; then
    pline "not found on $NET_LABEL" "$C_R"
    printf '\n%s\n' "$(printf '%s' "$js" | head -3 | cut -c1-$(inner_width))"
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
  kv tx "$h"
  kv status "$st"
  kv block "$(commify "$blk")"
  kv from "$(printf '%s' "$js" | jq -r '.from // "?"' 2>/dev/null)"
  kv to "$(printf '%s' "$js" | jq -r '.to // "(contract creation)"' 2>/dev/null)"
  kv value "$val"
  kv gasUsed "$(commify "$gasused")"
  printf '\n  %s%s/tx/%s%s\n' "$C_C" "$EXPLORER" "$h" "$C_RST"
  pause_enter
}

screen_help() {
  clear_screen
  local w
  w=$(inner_width)
  _ind() { printf "%${1}s" ""; }
  _wrap() { # <indent> <text...>
    local n="$1"; shift
    printf '%s\n' "$*" | fold -s -w $(( w - n )) | sed "s/^/$(_ind "$n")/"
  }
  _head() { printf '%s  %s%s\n' "$C_B" "$1" "$C_RST"; }

  printf '%s  ASAP WALLET %s%s\n\n' "$C_B$C_W" "$VERSION" "$C_RST"
  _wrap 2 "A basic wallet for the ASAP demo: balance, send MON, switch networks."
  printf '\n'
  _head NETWORKS
  _wrap 4 "testnet  chain 10143  https://testnet-rpc.monad.xyz  faucet.monad.xyz"
  _wrap 4 "mainnet  chain 143  https://rpc.monad.xyz  real MON, real money"
  printf '\n'
  _head SIGNING
  _wrap 4 "watch only - read balances for any address, cannot send."
  _wrap 4 "raw key - kept in this process memory only, never written to disk. It is"
  _wrap 6 "handed to cast as an argument, so it appears in ps while the tx is signed."
  _wrap 4 "keystore - ~/.foundry/keystores/<name>, encrypted at rest:"
  _wrap 8 "cast wallet import dev --interactive"
  _wrap 6 "the password is asked when the transfer is confirmed."
  printf '\n'
  _wrap 2 "Never paste a mainnet key holding more than you can afford to lose. Use a"
  _wrap 2 "burner for testnet and move real value into a keystore."
  printf '\n'
  _head ENVIRONMENT
  _wrap 4 "ADDRESS / PRIVATE_KEY   defaults on start (PRIVATE_KEY is memory only)"
  _wrap 4 "MON_IDR=15000           show IDR estimates at this rate"
  _wrap 4 "NO_COLOR=1              plain output"
  printf '\n'
  _head CLI
  _wrap 4 "--net mainnet   --addr 0x...   --account dev   --key 0x...   --once"
  _wrap 4 "--ask-key       prompt for the key instead of passing it in argv"
  _wrap 4 "--idr 15000     same as MON_IDR"
  printf '\n'
  _wrap 2 "State (network, watch address, last token) lives in"
  _wrap 2 "~/.config/asap-wallet/state - it never holds a private key."
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
  trap ':' WINCH

  local n=${#MENU_ITEMS[@]} now need_draw=1
  while :; do
    now=$(date +%s)
    # live balance: refresh in the background once the data is 30s old
    if [ -n "$W_ADDR" ] && [ "$CHECKED_EPOCH" -gt 0 ] \
       && [ $(( now - CHECKED_EPOCH )) -ge 30 ]; then
      fetch_stats >/dev/null 2>&1 && need_draw=1
    fi

    if [ "$need_draw" = "1" ]; then
      draw_main
      need_draw=0
    fi

    read_key
    case "$KEY" in
      up|k)      SEL=$(( (SEL - 1 + n) % n )) ;;
      down|j)    SEL=$(( (SEL + 1) % n )) ;;
      enter)     run_action "$SEL" || break ;;
      refresh|r) run_action 0 ;;
      s)         screen_send ;;
      n)         run_action 2 ;;
      w)         screen_wallet ;;
      t)         screen_erc20 ;;
      x)         screen_receipt ;;
      o)         open_explorer; fetch_stats >/dev/null 2>&1 ;;
      c)         copy_address ;;
      h|'?')     screen_help ;;
      q|quit)    break ;;
      tick)
        [ -t 0 ] || break                                  # tty gone
        [ "$(term_cols)x$(term_rows)" = "$CUR_SIZE" ] || need_draw=1 ;;
      *)         : ;;
    esac
    [ "$KEY" = "tick" ] || need_draw=1
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

if [ ! -t 0 ]; then
  echo "wallet-tui: needs an interactive terminal (use --once for a plain frame)" >&2
  exit 2
fi

fetch_stats >/dev/null 2>&1
set_msg "ready - press r to refresh, q to quit"
main_loop
