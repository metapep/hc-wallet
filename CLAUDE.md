# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

`hc-wallet` is a HashCash testnet wallet (iOS, Android, macOS via Catalyst) built with React Native and Electrum. The codebase began as a fork of BlueWallet 8.x and has been adapted to the HashCash chain: custom network parameters, SLIP44 coin type `1'` (testnet), and HashCash-specific Electrum endpoints. Bitcoin-only features (Lightning, marketplace, BTC widgets) are disabled via flags in [blue_modules/hashcash.ts](blue_modules/hashcash.ts) or removed outright.

When working in this repo, prefer the HashCash naming/branding for any new user-visible strings, file names, identifiers, and documentation. Leftover BlueWallet/Bitcoin terminology in source paths is being migrated incrementally — do not introduce new occurrences.

## Common Commands

```bash
# Development
npm start                    # Metro bundler
npm run ios                  # iOS
npm run android              # Android

# Testing
npm test                     # lint + unit + integration
npm run lint                 # ESLint + tsc + unused-loc check
npm run lint:fix             # auto-fix
npm run unit                 # Jest unit tests only
npm run integration          # Jest integration tests (requires network + test mnemonics)

# E2E (Detox, Android)
npm run e2e:debug
npm run e2e:release-test

# Clean
npm run clean                # full clean (gradle + node_modules + caches)
npm run clean:ios            # Pods + node_modules
npm run android:clean        # gradle clean + re-run android
```

## Architecture

**Directory Structure:**
- `components/` — React components and Context providers (SettingsProvider, StorageProvider)
- `class/` — Core business logic; wallet implementations in `class/wallets/`
- `blue_modules/` — Utility modules (BlueElectrum, currency, encryption, **hashcash**)
- `screen/` — Navigation screens by feature (wallets, send, receive, settings)
- `navigation/` — React Navigation setup with typed param lists
- `hooks/` — Custom hooks (useStorage, useSettings, useBiometrics, useScreenProtect)
- `loc/` — Localization (en.json is the source; 55+ languages inherited from BlueWallet)
- `models/` — Types for units, fiat, block explorers
- `tests/unit/`, `tests/integration/`, `tests/e2e/`

**HashCash chain integration:**
- `blue_modules/hashcash.ts` is the single source of truth for chain parameters: `HASHCASH_NETWORK` (bech32 prefix `hcash`, pubKeyHash 28, scriptHash 88, wif 212), derivation paths, Electrum peers, explorer URLs, and the runtime profile (`testnet` / `local`).
- `ensureHashcashNetwork()` patches `bitcoinjs-lib`'s `bitcoin.networks.bitcoin` at module load. All PSBT signing reads the patched network.
- Feature flags live in the same file: `LIGHTNING_ENABLED`, `DONATE_ENABLED`, `CURRENCY_SETTINGS_ENABLED`, `CLIPBOARD_AUTO_READ_ENABLED`.

**Wallet System:**
HD variants (HDSegwitBech32, HDLegacyP2PKH, HDSegwitP2SH, HDTaproot) and non-HD (Legacy, SegwitBech32, SegwitP2SH, Taproot, Multisig, Watch-only). Lightning wallet classes exist in source but are unreachable from the UI (gated by `LIGHTNING_ENABLED`). Types in `class/wallets/types.ts`.

**State Management:**
React Context providers wrap the app. Custom hooks expose state logic. Realm for transaction cache, `react-native-secure-key-store` / `react-native-keychain` for secrets, `react-native-default-preference` for settings.

**Navigation:**
React Navigation 7.x with native stack. Typed params in `navigation/DetailViewStackParamList.ts` and sibling param-list files.

## Code Conventions

**Commit Prefixes:** REL, FIX, ADD, REF, TST, OPS, DOC (e.g., `"ADD: new feature"`)

**TypeScript:** All new files must be TypeScript. Strict mode enabled.

**Dependencies:** Do not add new dependencies without strong justification. Bonus for removing dependencies — there are leftover Bitcoin-only libs (`silent-payments`, `@spsina/bip47`, `payjoin-client`, `bolt11`, `aezeed`, `bip38`) that can likely go.

**Components:** New components go in `components/`, not legacy `BlueComponents.tsx`.

**Linting Rules:**
- No inline styles in React Native (`react-native/no-inline-styles`: error)
- No unused styles (`react-native/no-unused-styles`: error)
- Prettier: single quotes, 140 char width, trailing commas

**Localization:** Keys live in `loc/en.json`. Run `node scripts/find-unused-loc.js` to detect unused keys. Some inherited key names still embed `bitcoin`/`bluewallet` tokens — these are internal and being phased out; do not introduce new ones.

## Testing

Unit tests in `tests/unit/` use Jest with `assert`. Test setup mocks React Native modules (Clipboard, Push Notifications, Keychain, etc.). HashCash-specific coverage in [tests/unit/hashcash-wallet-alignment.test.ts](tests/unit/hashcash-wallet-alignment.test.ts) asserts derivation paths and address prefix.

Integration tests require environment variables for test mnemonics (HD_MNEMONIC, HD_MNEMONIC_BIP84, etc.) and network access to HashCash testnet Electrum servers.
