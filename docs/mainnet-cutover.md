# Mainnet cutover plan

## Goal

Allow a single `hc-wallet` install to hold **both** testnet wallets (already created by users today) and mainnet wallets (created post-launch), without forcing reinstalls, without losing testnet funds, and without ambiguity about which chain a given wallet is on.

This is **design only** — do the implementation pieces under separate PRs once the protocol team confirms the mainnet parameters.

## What's load-bearing today

Everything chain-specific routes through one file: [blue_modules/hashcash.ts](blue_modules/hashcash.ts). It exports:

- `HASHCASH_NETWORK` — the bitcoinjs-lib `Network` object (bech32 `hcash`, pubKeyHash 28, scriptHash 88, wif 212).
- `HASHCASH_TESTNET_DERIVATION_PATH` and friends — BIP44/49/84/86 paths using SLIP44 coin type **`1'`**.
- `HASHCASH_ADDRESS_PREFIX = 'hcash1'`.
- `HCASH_ELECTRUM_PEERS` and `DEFAULT_BLOCK_EXPLORER_*` — endpoint selection by runtime profile (`testnet` or `local`).
- `ensureHashcashNetwork()` — patches `bitcoin.networks.bitcoin` at module load so every bitcoinjs-lib operation that doesn't receive an explicit `network` parameter still uses the right one.

These are imported by 30+ files across `class/`, `blue_modules/`, and `screen/`. Notable consumers:
- All wallets in `class/wallets/*.ts` (Legacy, SegwitBech32, SegwitP2SH, Taproot, HD variants, Multisig, Watch-only)
- `class/wallets/abstract-wallet.ts` ([line 385](class/wallets/abstract-wallet.ts:385)): default derivation path on import
- `class/wallets/abstract-hd-electrum-wallet.ts` ([line 1426 et al](class/wallets/abstract-hd-electrum-wallet.ts:1426)): every PSBT operation passes `network: HASHCASH_NETWORK`
- `class/wallet-import.ts`: BIP39 import enforces testnet derivation paths
- `class/deeplink-schema-match.ts`, `class/contact-list.ts`: address validation
- `blue_modules/BlueElectrum.ts`: ~10 call sites turn addresses into output scripts

## Open questions for the protocol team

Answer these **before** implementing. The right design depends on them.

1. **SLIP44 coin type for mainnet.** Testnet uses `1'`. Mainnet should be the registered HashCash coin type. If HashCash hasn't filed for one yet, the cutover plan must include an audit step to flag every wallet that used a placeholder.
2. **Bech32 HRP.** Does mainnet keep `hcash` or switch to (e.g.) `hcm`/`hcash1`? Affects address validation, block-explorer URLs, and any string-prefix checks in `class/`.
3. **Network parameter values (`pubKeyHash`, `scriptHash`, `wif`, `bip32.public`, `bip32.private`).** Same as testnet, or different? If they differ, the `HASHCASH_NETWORK` global needs to become per-wallet.
4. **Message-signing prefix.** Currently `"\x18HashCash Signed Message:\n"`. Stable across nets, or different?
5. **Mainnet Electrum hosts and block-explorer URL.** Required input for the `mainnet` profile.

## Proposed refactor

The current static-global model needs to become per-wallet runtime configuration.

### 1. Introduce `class/wallets/network.ts`

A new module that owns chain-parameter selection:

```ts
export type WalletNetwork = 'testnet' | 'mainnet';

export type ChainParams = {
  network: bitcoin.Network;
  bip44Path: string;
  bip49Path: string;
  bip84Path: string;
  bip86Path: string;
  addressPrefix: string;     // 'hcash1' for now; mainnet TBD
  uriScheme: string;         // 'hcash'
  electrumPeers: HcashElectrumPeer[];
  explorer: { url: string; apiBase: string; name: string };
};

export function chainParamsFor(network: WalletNetwork): ChainParams;
```

`blue_modules/hashcash.ts` keeps the legacy exports as thin wrappers around `chainParamsFor('testnet')` so existing imports keep compiling during the refactor.

### 2. Add `network` to `AbstractWallet`

```ts
abstract class AbstractWallet {
  network: WalletNetwork = 'testnet'; // existing wallets default here
  // ...
}
```

- Serialize/deserialize in `class/blue-app.ts` (the wallet storage layer).
- Migration: any wallet record without a `network` field is read as `'testnet'`. Write back the explicit field on next save.
- Wallet creation (`screen/wallets/Add.tsx`) gets a network selector once mainnet is live; for now it's hardcoded to `'testnet'`.

### 3. Replace static `HASHCASH_NETWORK` usage with `this.network` lookups

Every line currently doing `network: HASHCASH_NETWORK` becomes `network: chainParamsFor(this.network).network`. Concretely:

- `class/wallets/abstract-hd-electrum-wallet.ts:1426/1439/1454/1455` — PSBT signing
- `class/wallets/legacy-wallet.ts:81/429/471/550/576` — payments + PSBT
- `class/wallets/hd-taproot-wallet.ts:46` — payments
- `class/wallets/hd-legacy-breadwallet-wallet.ts:48/49` — payments
- `class/wallets/hd-segwit-bech32-wallet.ts:17` — static `derivationPath` constant must become a per-instance getter
- `class/wallets/abstract-wallet.ts:385` — default-derivation-path branch in the BIP39 import path

For free functions (`class/deeplink-schema-match.ts`, `class/contact-list.ts`, `blue_modules/BlueElectrum.ts`) the choice is:
- Pass `network` explicitly as a parameter, **or**
- Keep using `chainParamsFor('testnet')` for general / non-wallet-attached operations like deep-link parsing and contact-list validation, and tolerate both prefixes by trying each in turn.

Deep-link parsing in particular needs to accept both `hcash:` addresses, regardless of whether the active wallet is testnet or mainnet, because the user may have multiple wallets across both chains. The simplest path: try mainnet validation; on failure, try testnet.

### 4. Stop calling `ensureHashcashNetwork()`

The global mutation of `bitcoin.networks.bitcoin` is what makes the static-network model work today; once every call site passes `network` explicitly, this side effect becomes dead code. Removing it should be the *last* step of the refactor — until then it serves as a safety net.

### 5. Update `BlueElectrum.ts` peer selection

`HCASH_ELECTRUM_PEERS` becomes a function `peersFor(network: WalletNetwork)`. The Electrum connection in `connectMain()` is shared across all wallets; if a user has both testnet and mainnet wallets we either:

- Maintain two Electrum connections, segmented by network (cleaner; matches how mainnet+testnet co-existence works in other multichain wallets), or
- Continue with one Electrum connection per app session, switched when the user changes which "network" they're viewing.

I recommend the first option but the second is faster to ship.

### 6. UI surface

- Wallet creation: add a network selector (testnet / mainnet). Default to mainnet once it's live; testnet remains available behind a toggle in Settings → Developer.
- Wallet list: badge each wallet with its network (`Testnet` chip). Already-existing testnet wallets will all get the badge.
- Block explorer links: `chainParamsFor(wallet.network).explorer.url`.
- Send screen: validate destination address against `wallet.network` first; if it fails with a hint that it's a mainnet address pasted into a testnet send (or vice versa), surface that exact error rather than the generic "invalid address".

## Migration of existing testnet wallets

The lazy approach is sufficient:
1. Ship the refactor with `network` defaulting to `'testnet'` for records that don't have it.
2. On every wallet save (re-encryption pass in `class/blue-app.ts:725`), write the explicit field.
3. Users with testnet-only wallets see no UI change.
4. Users who create a mainnet wallet post-update get a separate slot in the same install.

No forced re-import. No funds movement. Existing testnet wallets keep their HCASH and their seed phrase unchanged.

## Pre-flight checklist for the mainnet release

- [ ] Mainnet SLIP44 coin type confirmed and reserved
- [ ] Mainnet network parameters confirmed against the HashCash protocol spec
- [ ] Mainnet Electrum host(s) live and reachable from a clean install
- [ ] Mainnet block explorer URL live
- [ ] `chainParamsFor('mainnet')` smoke-tested: create a new HD wallet, generate an address, decode the address, sign a message
- [ ] Test cohort: ship a build to a small group of internal users with both a testnet wallet (pre-existing) and a mainnet wallet (new). Confirm both work side-by-side, balances do not bleed across nets, and Electrum traffic is segmented correctly.
- [ ] Privacy review: when a single user has both networks, do log files or Bugsnag breadcrumbs leak which net a given operation belongs to?
- [ ] App Store / Play Store listing updated to remove "testnet" qualifier.

## Scope warning

This refactor is **not** a chore. Plan for:

- A 1–2 week effort across `class/`, `blue_modules/`, and `screen/`.
- Comprehensive unit tests in `tests/unit/` (HashCash wallet alignment, derivation-path enforcement) need to be parameterized over both networks.
- A real-device QA pass on both iOS and Android with a wallet of each network.
- A separate effort to stand up the mainnet Electrum endpoint that the app will point to.

Do not try to combine this with any other large change in the same release.
