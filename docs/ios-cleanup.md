# iOS cleanup checklist

These steps require Xcode and are not safe to perform by editing `project.pbxproj` directly. Do them once before the testnet release; the rest of the codebase has already been adjusted to no longer reference these targets from JS or Android.

Open `ios/BlueWallet.xcworkspace` for all steps.

## 1. Remove the Apple Watch targets

The `BlueWalletWatch` and `BlueWalletWatch Extension` targets are inherited from BlueWallet and mirror Bitcoin-specific behavior. HashCash should ship without a Watch companion until one is purpose-built.

In Xcode:
1. Select the `BlueWallet` project in the navigator.
2. Under **TARGETS**, right-click `BlueWalletWatch` → **Delete**.
3. Right-click `BlueWalletWatch Extension` → **Delete**.
4. In the Project Navigator (file tree), delete the `BlueWalletWatch` and `BlueWalletWatch Extension` groups. Choose **Move to Trash**.
5. Build setting **Embed Watch Content** on the main app target should be cleared automatically; verify under **Build Phases → Embed Watch Content** that nothing remains.

After Xcode confirms the targets are gone, also remove on disk:
```
rm -rf ios/BlueWalletWatch
rm -rf "ios/BlueWalletWatch Extension"
```

## 2. Remove the Stickers target

`ios/Stickers/` ships BlueWallet-mascot iMessage stickers (`bluebeast.sticker` etc). Not appropriate for a HashCash wallet.

In Xcode:
1. Right-click the `Stickers` target → **Delete**.
2. Delete the `Stickers` group from the Project Navigator → **Move to Trash**.

Then:
```
rm -rf ios/Stickers
rm -f img/bluebeast.png
```

## 3. Remove the home-screen Widgets target

The `Widgets` / `WalletInformationWidget` extensions mirror the Android Bitcoin price widget that has already been deleted from this codebase. They depend on BTC market data that doesn't exist for HashCash testnet.

In Xcode:
1. Right-click the `Widgets` target (and `WalletInformationWidget` if it's a separate target) → **Delete**.
2. Delete the `Widgets` group → **Move to Trash**.
3. In **Build Phases** on the main app target, remove any **Embed App Extensions** entry that referenced these targets.

Then remove on disk:
```
rm -rf ios/Widgets
rm -rf ios/WalletInformationWidget
rm -f ios/Shared/WidgetData.swift
rm -f ios/Shared/WidgetDataStore.swift
rm -f ios/WidgetHelper.swift
rm -f ios/NativeWidgetHelperSpec.h
rm -f ios/Components/WidgetHelper.swift
rm -f ios/Components/WidgetHelper.mm
rm -f ios/WidgetsExtension.entitlements
```

And remove the now-orphaned JS shim:
```
rm -f blue_modules/NativeWidgetHelper.ts
rm -f codegen/NativeWidgetHelper.ts
```

Update `codegen/codegen.config.js` (or whichever file registers codegen specs) to drop `NativeWidgetHelper`. The Android side has no widget code paths left after the prior cleanup, so nothing further is needed there.

## 4. Rename the iOS project & folder to drop "BlueWallet"

This is purely cosmetic — bundle ID, display name, and module name are already HashCash-aligned — but the on-disk structure and Xcode scheme still say "BlueWallet". TestFlight uploads will display the scheme name to internal testers, and any reviewer browsing the source will trip over it.

Recommended target name: `hcWallet` (matches the repo) or `HashCashWallet`.

In Xcode:
1. Click the project root in the navigator. In the inspector, edit the **Project name** field from `BlueWallet` to `hcWallet`. Xcode will offer to rename related items — accept all.
2. Rename the main target (`BlueWallet` → `hcWallet`).
3. **Product → Scheme → Manage Schemes** — rename the `BlueWallet` scheme to `hcWallet` and ensure **Shared** is ticked.
4. Close Xcode.

Then rename on disk:
```
git mv ios/BlueWallet ios/hcWallet
git mv ios/BlueWallet-Bridging-Header.h ios/hcWallet-Bridging-Header.h
git mv ios/BlueWallet.xcodeproj ios/hcWallet.xcodeproj
git mv ios/BlueWallet.xcworkspace ios/hcWallet.xcworkspace
git mv ios/BlueWalletTests ios/hcWalletTests        # only if you want to keep tests
git mv ios/BlueWalletUITests ios/hcWalletUITests    # only if you want to keep UI tests
```

Open `ios/hcWallet.xcworkspace` and verify:
- `Info.plist` path resolves under **Build Settings → INFOPLIST_FILE**.
- The Swift bridging header path under **Objective-C Bridging Header** points to `hcWallet/hcWallet-Bridging-Header.h`.
- `pod install` runs clean.
- The app builds and launches.

## 5. Update the Detox config and Fastlane

After step 4, edit:

- `.detoxrc.json` — replace `ios/BlueWallet.xcworkspace`, `-scheme BlueWallet`, and `BlueWallet.app` with the renamed equivalents.
- `fastlane/Fastfile` — replace any `BlueWallet.xcodeproj`, scheme `BlueWallet`, or output-name `BlueWallet` references.
- `.github/workflows/build-release-apk.yml` (Android) — the `BlueWallet-*.apk` filename is handled separately in step 6 below.

## 6. Verify the end state

- `xcodebuild -workspace ios/hcWallet.xcworkspace -scheme hcWallet -configuration Release -sdk iphonesimulator` builds.
- Detox `npm run e2e:debug-build` succeeds on Android.
- `git grep -i bluewallet -- ios/` returns only intentional leftovers (e.g. comments in vendored code under `node_modules/` are out of scope).
