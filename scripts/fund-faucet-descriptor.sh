#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: ${name}" >&2
    exit 1
  fi
}

rpc_call() {
  local url="$1"
  local payload="$2"
  printf '%s' "$payload" | curl -fsS --user "$RPC_AUTH" -H 'content-type: text/plain;' --data-binary @- "$url"
}

normalize_path() {
  local path="$1"
  path="${path/#m\//}"
  path="${path//\'/h}"
  printf '%s' "$path"
}

require_env PRIVATE_KEY
require_env HD_PATH
require_env FAUCET_ADDR
require_env AMOUNT

RPC_URL="${RPC_URL:-http://127.0.0.1:20309}"
RPC_COOKIE_FILE="${RPC_COOKIE_FILE:-}"
WALLET_NAME="${WALLET_NAME:-faucetfund_$(date +%Y%m%d%H%M%S)}"
RESCAN="${RESCAN:-true}"
DESCRIPTOR_TIMESTAMP="${DESCRIPTOR_TIMESTAMP:-0}"

if [[ -z "${RPC_AUTH:-}" ]]; then
  require_env RPC_COOKIE_FILE
  RPC_AUTH="$(cat "$RPC_COOKIE_FILE")"
fi

relative_path="$(normalize_path "$HD_PATH")"
descriptor="wpkh(${PRIVATE_KEY}/${relative_path})"
unset PRIVATE_KEY

descriptor_payload="$(jq -nc --arg desc "$descriptor" '{jsonrpc:"1.0",id:"desc",method:"getdescriptorinfo",params:[$desc]}')"
checked_descriptor="$(rpc_call "$RPC_URL" "$descriptor_payload" | jq -er '.result.descriptor')"
unset descriptor

list_wallets_payload="$(jq -nc '{jsonrpc:"1.0",id:"listwallets",method:"listwallets",params:[]}')"
if ! rpc_call "$RPC_URL" "$list_wallets_payload" | jq -e --arg name "$WALLET_NAME" 'any(.result[]; . == $name)' >/dev/null; then
  list_wallet_dir_payload="$(jq -nc '{jsonrpc:"1.0",id:"listwalletdir",method:"listwalletdir",params:[]}')"
  if rpc_call "$RPC_URL" "$list_wallet_dir_payload" | jq -e --arg name "$WALLET_NAME" 'any(.result.wallets[]?; .name == $name)' >/dev/null; then
    load_payload="$(jq -nc --arg name "$WALLET_NAME" '{jsonrpc:"1.0",id:"loadwallet",method:"loadwallet",params:[$name]}')"
    rpc_call "$RPC_URL" "$load_payload" >/dev/null
  else
    create_payload="$(jq -nc --arg name "$WALLET_NAME" '{jsonrpc:"1.0",id:"createwallet",method:"createwallet",params:[$name,false,false,"",false,true]}')"
    rpc_call "$RPC_URL" "$create_payload" >/dev/null
  fi
fi

wallet_url="${RPC_URL%/}/wallet/${WALLET_NAME}"
import_payload="$(jq -nc --arg desc "$checked_descriptor" --arg timestamp "$DESCRIPTOR_TIMESTAMP" --argjson rescan "$RESCAN" '{
  jsonrpc:"1.0",
  id:"importdescriptors",
  method:"importdescriptors",
  params:[[{
    desc:$desc,
    timestamp:$timestamp,
    active:false,
    internal:false,
    rescan:$rescan
  }]]
}')"
rpc_call "$wallet_url" "$import_payload" | jq -e '.result[0].success == true' >/dev/null
unset checked_descriptor

balance_payload="$(jq -nc '{jsonrpc:"1.0",id:"balance",method:"getbalance",params:[]}')"
balance="$(rpc_call "$wallet_url" "$balance_payload" | jq -er '.result')"
echo "funding_wallet=${WALLET_NAME}"
echo "funding_wallet_trusted_balance=${balance}"

awk -v bal="$balance" -v amt="$AMOUNT" 'BEGIN { exit !((bal + 0) >= (amt + 0)) }' || {
  echo "insufficient trusted balance to send ${AMOUNT}" >&2
  exit 1
}

send_payload="$(jq -nc --arg addr "$FAUCET_ADDR" --argjson amount "$AMOUNT" '{
  jsonrpc:"1.0",
  id:"fund-faucet",
  method:"sendtoaddress",
  params:[$addr,$amount]
}')"
rpc_call "$wallet_url" "$send_payload" | jq -er '.result'
