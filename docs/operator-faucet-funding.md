# Operator Faucet Funding

This wallet is public-user software. Keep faucet funding and descriptor import flows in operator runbooks, not in the public wallet UI.

HashCash Core requires descriptor wallets. Do not use legacy `importprivkey` for faucet funding on current nodes. Import a descriptor derived from the operator mnemonic or extended private key, rescan it, and send from that temporary funding wallet to the faucet wallet address.

## Inputs

- `PRIVATE_KEY`: operator-controlled extended private key stored in private ops secrets.
- `HD_PATH`: full child path for the funding address, for example `m/84h/1h/0h/0/0`.
- `FAUCET_ADDR`: current faucet wallet receive address.
- `AMOUNT`: amount to transfer to the faucet wallet.

For the current testnet-only mobile release, the first BIP84 receive address is derived at:

```text
m/84'/1'/0'/0/0
```

## Core Flow

1. Create or load a temporary descriptor wallet on the testnet node.
2. Convert the funding key and `HD_PATH` into a `wpkh(...)` descriptor.
3. Ask Core for the descriptor checksum with `getdescriptorinfo`.
4. Import the checksummed descriptor with `importdescriptors`.
5. Confirm the funding wallet has trusted balance.
6. Send funds to `FAUCET_ADDR` with `sendtoaddress`.
7. Confirm the faucet wallet sees the incoming transaction and later trusted balance.

Use a short-lived funding wallet name and avoid storing the operator key on disk longer than the command requires.

## Helper Script

From a machine that can reach the private Core RPC endpoint:

```bash
export PRIVATE_KEY="operator_extended_private_key"
export HD_PATH="m/84h/1h/0h/0/0"
export FAUCET_ADDR="hcash1..."
export AMOUNT="10000"
export RPC_URL="http://127.0.0.1:20309"
export RPC_COOKIE_FILE="/srv/hashcash/chain/.hashcash/.cookie"
export DESCRIPTOR_TIMESTAMP="0"
export RESCAN="true"

scripts/fund-faucet-descriptor.sh
```

The script creates or loads a temporary descriptor wallet, imports the checksummed `wpkh(...)` descriptor, verifies trusted balance, then sends `AMOUNT` to `FAUCET_ADDR`.

## Notes

- If Core reports that legacy wallets are unavailable, that is expected. Use descriptor import.
- If descriptor import reports a key path parse error, normalize `HD_PATH` before building the descriptor: `m/84h/1h/0h/0/0` and `m/84'/1'/0'/0/0` describe the same path, but descriptor syntax cannot contain an empty path component.
- Use `DESCRIPTOR_TIMESTAMP=0` for a full testnet rescan when recovering existing funds. Use a later Unix timestamp only when you know the funding key cannot have older transactions.
- Keep release wallet UX minimal: seed backup and normal receive/send flows only. Do not add broad public descriptor or private-key export for faucet operations.
