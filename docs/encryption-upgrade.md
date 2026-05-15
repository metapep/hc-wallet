# Encryption upgrade: from crypto-js OpenSSL → PBKDF2-SHA256 + AES-CBC + HMAC

## What changed

`blue_modules/encryption.ts` now writes a versioned envelope:

```
v1:<base64-salt>:<base64-iv>:<base64-ciphertext>:<base64-mac>
```

- `salt`        — 16 random bytes
- `iv`          — 16 random bytes (AES-256-CBC)
- `ciphertext`  — AES-256-CBC(plaintext, encKey, iv)
- `mac`         — HMAC-SHA256(salt ‖ iv ‖ ciphertext, hmacKey)
- `encKey`      — PBKDF2-SHA256(password, salt, **600 000 iterations**, 64 bytes)[0:32]
- `hmacKey`     — PBKDF2-SHA256(password, salt, **600 000 iterations**, 64 bytes)[32:64]

PBKDF2 runs via `@noble/hashes` (Uint8Array, fast on Hermes). The MAC is verified before AES decryption — wrong passwords are rejected without padding-oracle exposure.

Iteration count matches OWASP 2023 guidance for PBKDF2-SHA256. On real mobile hardware expect roughly 3–10 seconds per unlock; tune `V1_ITERATIONS` if device QA shows this is unacceptable for users on low-end Android.

## Why

The pre-existing implementation called `crypto-js` `AES.encrypt(data, password)` directly. Internally that uses the OpenSSL key-derivation format (`EVP_BytesToKey`-style, MD5, **one round**) with an 8-byte salt. Trivially brute-forceable against weak passphrases, with no authentication tag (a tampered ciphertext could decrypt to attacker-chosen plaintext if the padding happened to validate).

The new envelope:
- replaces 1-round MD5 KDF with 600 000-round PBKDF2-SHA256
- adds an explicit 32-byte HMAC-SHA256 tag so tampering is detected
- keeps everything in pure JS (no new native deps) by relying on `@noble/hashes` for fast PBKDF2 and `crypto-js` for AES-CBC

## Compatibility & migration

`decrypt()` reads both formats. If the input starts with `v1:` it goes through the new path; otherwise it falls through to the legacy `crypto-js` decoder. `encrypt()` always produces v1 envelopes.

Migration is **lazy**:
1. User unlocks a wallet whose on-disk blob is legacy format.
2. `decrypt()` succeeds (legacy path).
3. The storage layer (`class/blue-app.ts`) eventually re-saves the wallet — every wallet mutation re-encrypts before write, so the next save produces a v1 envelope and replaces the legacy blob.
4. After the next save, the wallet is on the new format permanently.

`isLegacyCiphertext()` is exported for any future code that wants to force an eager migration on app start.

### Where `decrypt`/`encrypt` are called today

- [class/blue-app.ts:202](class/blue-app.ts:202) — `loadFromDisk()` decrypts each stored bucket.
- [class/blue-app.ts:233](class/blue-app.ts:233) — `setIsEncrypted(true)` writes the user-supplied data with `encrypt()`.
- [class/blue-app.ts:260](class/blue-app.ts:260) — `createFakeStorage()` (plausible-deniability decoy bucket).
- [class/blue-app.ts:716](class/blue-app.ts:716) and [class/blue-app.ts:725](class/blue-app.ts:725) — bucket re-encryption on save (this is the lazy-migration path).
- [screen/settings/SelfTest.tsx:12](screen/settings/SelfTest.tsx:12) — in-app self-test.

No call site reads ciphertext as opaque bytes, so the format change is invisible to them.

## Risks & follow-ups

- **Existing devices**: testnet users who installed pre-upgrade have data in legacy format. The lazy migration above handles them. If we ever decide to drop legacy decryption support, gate that decision on a telemetry signal that essentially all wallets have already been re-saved (or do an eager migration in `loadFromDisk()`).
- **Bench on device, not in Node**: `npx jest tests/unit/encryption.test.ts` runs ~7 s per derivation in Node V8. Hermes on Android Go-class devices will be slower. If a representative test device takes more than ~10 s, lower `V1_ITERATIONS` to 300 000 (still OWASP-acceptable) before mainnet.
- **Argon2id** is the modern recommendation over PBKDF2. A future move to Argon2id would require a native module (no maintained pure-JS implementation runs at usable speed on Hermes). Tracked as a v2 cipher version — the envelope already carries a version prefix so adding `v2:` later is mechanical.
- **WordArray.random**: uses `react-native-get-random-values` polyfill on device (loaded from `index.js`). In a non-RN test environment (Node) it falls back to `Math.random`, which is fine for the unit tests but should be revisited if these helpers ever ship a pure-Node build.

## Unit tests

`tests/unit/encryption.test.ts` covers:
- v1 round trip
- ciphertext uniqueness (salt + IV randomness)
- v1 tamper detection (HMAC rejects modified ciphertext)
- malformed input returns `false` instead of throwing
- legacy `CryptoJS@3.1.9-1` ciphertext still decrypts correctly

Run with `npx jest tests/unit/encryption.test.ts`. The suite finishes in ~30 s due to the PBKDF2 cost.
