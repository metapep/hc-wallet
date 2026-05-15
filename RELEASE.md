# Release process

This document covers the testnet release process for `hc-wallet`. A mainnet section will be added once HashCash mainnet is live.

## Versioning

`package.json` `version` is the user-visible version (e.g. `8.0.0`). It is mirrored to:
- `android/app/build.gradle` → `versionName`
- iOS Info.plist → `CFBundleShortVersionString`

`versionCode` (Android) and `CFBundleVersion` (iOS) are monotonically increasing integers; bump on every store submission, including TestFlight builds.

A helper exists to update the strings in one place: `./scripts/edit-version-number.sh`.

## Pre-release checklist

- [ ] `npm run lint && npm run unit` clean
- [ ] Release-build APK and IPA actually install on a real device and pass a smoke test (generate wallet → receive testnet funds → send → close → reopen)
- [ ] Capture protection works on `PleaseBackup`, `ImportWallet`, `WalletExport` (verified by attempting a screenshot)
- [ ] Network traffic audit: no requests to `bluewallet.io`, `groundcontrol-bluewallet.herokuapp.com`, or BlueWallet Firebase. The only third-party endpoints expected are `electrum.hashcash-test.network`, `explorer.hashcash-test.network`, `groundcontrol.hashcash.network`, and the Firebase / Bugsnag endpoints for the `hashcash-wallet` projects.
- [ ] No Bitcoin-branded home-screen widgets in the build (Android)
- [ ] Store listing copy says "HashCash testnet wallet", not "Bitcoin wallet"
- [ ] Privacy policy + terms URLs (`hashcash.network/privacy`, `/terms`) resolve
- [ ] `release-notes.txt` updated (`./scripts/release-notes.sh` regenerates the JSON)

## Android

### Signing keystore

The release keystore is **not** committed. It must be available at the path referenced by `HCASH_UPLOAD_STORE_FILE` in `android/gradle.properties` (or be overridden by CI environment variables). The keystore password, key alias, and key password are injected from CI secrets.

Local placeholders in `gradle.properties`:
```
HCASH_UPLOAD_STORE_FILE=/path/to/hcash-release.jks
HCASH_UPLOAD_STORE_PASSWORD=__SET_YOUR_KEYSTORE_PASSWORD__
HCASH_UPLOAD_KEY_ALIAS=hcash-upload
HCASH_UPLOAD_KEY_PASSWORD=__SET_YOUR_KEY_PASSWORD__
```

### Build

```
cd android
./gradlew bundleRelease   # AAB for Play Store
./gradlew assembleRelease # APK for sideload / BrowserStack
```

Outputs:
- `android/app/build/outputs/bundle/release/app-release.aab`
- `android/app/build/outputs/apk/release/app-release.apk`

### CI

`.github/workflows/build-release-apk.yml` builds and signs on push to `master`. It uploads the signed APK as a workflow artifact.

## iOS

### Signing & profiles

Signing is handled by Fastlane match (or the manual Xcode flow if match is not configured). The bundle identifier is `network.hashcash.wallet`.

### Build

Via Fastlane:
```
cd fastlane
bundle exec fastlane ios beta   # TestFlight
```

Or manually:
1. Open `ios/<scheme>.xcworkspace` in Xcode.
2. Select **Generic iOS Device** or **Any iOS Device (arm64)**.
3. **Product → Archive**.
4. From the Organizer, **Distribute App → App Store Connect → Upload**.

### TestFlight

Build numbers must be unique per app version. Bump `CFBundleVersion` before each upload.

## Tagging

```
git tag -a vX.Y.Z -m "REL vX.Y.Z: <summary>"
git push origin vX.Y.Z
```

Use the `REL` commit prefix when bumping the version in code:

```
REL vX.Y.Z: <summary message>
```

## Post-release

- Confirm crash-reporting events arrive at the HashCash Bugsnag project (once provisioned).
- Monitor TestFlight feedback and Play Console pre-launch reports.
- File any regressions as `FIX` commits on a release branch and cherry-pick to `master`.
