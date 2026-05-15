# FAQ

## What network does this wallet connect to?

The testnet build connects to `electrum.hashcash-test.network` (Electrum on ports 50001/50002) and the testnet block explorer at `explorer.hashcash-test.network`. Development builds can also target a local node by setting `HCASH_WALLET_PROFILE=local`. See [blue_modules/hashcash.ts](blue_modules/hashcash.ts).

## Where are my keys stored?

On the device only. Mnemonics and private keys are kept in the OS-provided secure store (`react-native-secure-key-store` / `react-native-keychain`) under the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility class. They never leave the device.

## Why so many Node dependencies? Who audits them?

This codebase inherits its dependency tree from BlueWallet. Versions are pinned, and risky or anonymously maintained packages are forked under a controlled namespace. PRs that remove dependencies are particularly welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Does hc-wallet download block headers?

No. The wallet trusts the Electrum server it is connected to. By default that is a HashCash-operated testnet server. Users can configure a custom Electrum server in **Settings → Network → Electrum** (in development builds) if they prefer to trust their own infrastructure.

Proper SPV verification would be required for a "random server from a public pool" model. That is not the current design.

## Is Lightning supported?

No. Lightning code paths are gated off (`LIGHTNING_ENABLED = false` in `blue_modules/hashcash.ts`) and are unreachable from the UI.

## When mainnet?

Mainnet support will ship as an update once HashCash mainnet is live. Wallets created in the testnet build are tied to SLIP44 coin type `1'` (testnet) and will continue to work on testnet after the update; mainnet wallets will be a separate slot in the same install.
