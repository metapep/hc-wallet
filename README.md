# HashCash Wallet (hc-wallet)

A self-custodial HashCash testnet wallet for iOS and Android, built with React Native and Electrum.

* Private keys never leave your device
* HD wallets with BIP39 mnemonic backup
* BIP44 / BIP49 / BIP84 / BIP86 (Taproot) support
* Watch-only and multisig wallets
* Local encryption with plausible-deniability buckets
* Biometric protection and screen-capture protection on sensitive screens

> **Status:** Testnet only. This build connects to `electrum.hashcash-test.network` and uses SLIP44 coin type `1'`. A mainnet release will follow as an update once HashCash mainnet is live.

This codebase began as a fork of [BlueWallet](https://github.com/BlueWallet/BlueWallet) 8.x and is being adapted into a HashCash-native wallet. Bitcoin-only features (Lightning, marketplace, BTC widgets) are disabled or removed.

## Build & run

Refer to the `engines` field in `package.json` for the minimum required Node version. Use an even-numbered LTS Node release.

```
git clone <hc-wallet repo url>
cd hc-wallet
npm install
```

### Android

1. Install Android Studio and create or attach an emulator via AVD Manager (open `android/build.gradle` to import the project).
2. Run the app:

```
npm run android
```

### iOS

```
npx pod-install
npm start
```

In another terminal:

```
npm run ios
```

When using the iOS Simulator on Apple silicon, choose a Rosetta-compatible simulator via **Product → Destination → Destination Architectures → Show Both** in Xcode.

### macOS (Mac Catalyst)

```
npx pod-install
npm start
```

Open `ios/<scheme>.xcworkspace`, select the macOS scheme, and Run.

### Profiles

A development build can target either the public testnet or a local node by setting `HCASH_WALLET_PROFILE`:

- `HCASH_WALLET_PROFILE=testnet` — `electrum.hashcash-test.network` (default)
- `HCASH_WALLET_PROFILE=local` — `127.0.0.1` (Electrum 50001/50002, explorer 18080)

Release builds always use `testnet`. See [blue_modules/hashcash.ts](blue_modules/hashcash.ts).

## Tests

```
npm test            # lint + unit + integration
npm run lint        # ESLint + tsc + unused-loc check
npm run unit        # Jest unit tests
npm run integration # Jest integration tests (requires network + test mnemonics)
```

E2E (Detox) tests run on Android in CI:

```
npm run e2e:debug
npm run e2e:release-test
```

## License

MIT. See [LICENSE](LICENSE).

## Responsible disclosure

Security issues: `security@hashcash.network`. Please do not file public issues for vulnerabilities.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
