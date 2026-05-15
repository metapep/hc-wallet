import AES from 'crypto-js/aes';
import EncBase64 from 'crypto-js/enc-base64';
import EncUtf8 from 'crypto-js/enc-utf8';
import WordArray from 'crypto-js/lib-typedarrays';
import type { lib } from 'crypto-js';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';

// Storage format for hc-wallet vaults:
//
//   "v1:" + base64(salt) + ":" + base64(iv) + ":" + base64(ciphertext) + ":" + base64(mac)
//
// Where:
//   salt        = 16 random bytes (PBKDF2 input)
//   iv          = 16 random bytes (AES-256-CBC IV)
//   ciphertext  = AES-256-CBC(plaintext, encKey, iv)
//   mac         = HMAC-SHA256(salt || iv || ciphertext, hmacKey)
//   encKey      = first 32 bytes of PBKDF2-SHA256(password, salt, V1_ITERATIONS, 64 bytes)
//   hmacKey     = last 32 bytes of the same PBKDF2 output
//
// The MAC is verified before AES decryption; on mismatch we reject the
// password without attempting to decrypt.
//
// Legacy format (still readable, never produced):
//   crypto-js OpenSSL-format AES output (a base64 string starting with
//   "U2FsdGVkX1..."). This is what the codebase shipped prior to v1 and what
//   user devices may still have on disk after an in-place upgrade. On any
//   successful decrypt of legacy data, the caller is expected to re-save via
//   `encrypt()`, which produces a v1 envelope and migrates that record in
//   place. `isLegacyCiphertext()` is provided so storage layers can decide
//   whether to force a re-save.
//
// PBKDF2 runs via @noble/hashes (Uint8Array fast path) rather than crypto-js's
// pure-JS implementation, which would block the UI thread for tens of seconds
// on Hermes at this iteration count.

const V1_PREFIX = 'v1:';
const V1_ITERATIONS = 600_000;
const V1_SALT_BYTES = 16;
const V1_IV_BYTES = 16;
const V1_KEY_BYTES = 64; // 32 enc + 32 hmac

const MIN_PLAINTEXT_LEN = 10;

type CJWordArray = lib.WordArray;

function uint8ArrayToWordArray(bytes: Uint8Array): CJWordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0),
    );
  }
  const wa = WordArray.create(words);
  wa.sigBytes = bytes.length;
  return wa;
}

function wordArrayToUint8Array(wa: CJWordArray): Uint8Array {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i += 1) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  // crypto-js WordArray.random uses Math.random under React Native unless
  // react-native-get-random-values is loaded (it is — see index.js). Round
  // trip through WordArray to keep one source of randomness in the file and
  // pick up that polyfill consistently.
  return wordArrayToUint8Array(WordArray.random(n));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function utf8Encode(s: string): Uint8Array {
  // RN/Hermes has TextEncoder via the React Native polyfills. Fall back to
  // Buffer if not available (Node test environment).
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  return new Uint8Array(Buffer.from(s, 'utf8'));
}

function deriveV1Keys(password: string, salt: Uint8Array): { encKey: Uint8Array; hmacKey: Uint8Array } {
  const derived = pbkdf2(sha256, utf8Encode(password), salt, { c: V1_ITERATIONS, dkLen: V1_KEY_BYTES });
  return {
    encKey: derived.slice(0, V1_KEY_BYTES / 2),
    hmacKey: derived.slice(V1_KEY_BYTES / 2),
  };
}

function encryptV1(data: string, password: string): string {
  const salt = randomBytes(V1_SALT_BYTES);
  const iv = randomBytes(V1_IV_BYTES);
  const { encKey, hmacKey } = deriveV1Keys(password, salt);

  const cipher = AES.encrypt(EncUtf8.parse(data), uint8ArrayToWordArray(encKey), {
    iv: uint8ArrayToWordArray(iv),
  });
  const ciphertext = wordArrayToUint8Array(cipher.ciphertext);

  const mac = hmac(sha256, hmacKey, concatBytes(salt, iv, ciphertext));

  return [
    'v1',
    EncBase64.stringify(uint8ArrayToWordArray(salt)),
    EncBase64.stringify(uint8ArrayToWordArray(iv)),
    EncBase64.stringify(uint8ArrayToWordArray(ciphertext)),
    EncBase64.stringify(uint8ArrayToWordArray(mac)),
  ].join(':');
}

function decryptV1(blob: string, password: string): string | false {
  const parts = blob.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') return false;
  let saltWA: CJWordArray;
  let ivWA: CJWordArray;
  let ctWA: CJWordArray;
  let macBytes: Uint8Array;
  try {
    saltWA = EncBase64.parse(parts[1]);
    ivWA = EncBase64.parse(parts[2]);
    ctWA = EncBase64.parse(parts[3]);
    macBytes = wordArrayToUint8Array(EncBase64.parse(parts[4]));
  } catch {
    return false;
  }
  if (saltWA.sigBytes !== V1_SALT_BYTES || ivWA.sigBytes !== V1_IV_BYTES || macBytes.length !== 32) {
    return false;
  }

  const salt = wordArrayToUint8Array(saltWA);
  const iv = wordArrayToUint8Array(ivWA);
  const ciphertext = wordArrayToUint8Array(ctWA);

  const { encKey, hmacKey } = deriveV1Keys(password, salt);
  const expectedMac = hmac(sha256, hmacKey, concatBytes(salt, iv, ciphertext));
  if (!constantTimeEqual(expectedMac, macBytes)) return false;

  try {
    const plaintextBytes = AES.decrypt(
      { ciphertext: ctWA } as Parameters<typeof AES.decrypt>[0],
      uint8ArrayToWordArray(encKey),
      { iv: ivWA },
    );
    const plaintext = plaintextBytes.toString(EncUtf8);
    if (!plaintext || plaintext.length < MIN_PLAINTEXT_LEN) return false;
    return plaintext;
  } catch {
    return false;
  }
}

function decryptLegacy(blob: string, password: string): string | false {
  const bytes = AES.decrypt(blob, password);
  let str: string | false = false;
  try {
    str = bytes.toString(EncUtf8);
  } catch {
    // crypto-js raises "Malformed UTF-8 data" on wrong password sometimes
  }
  // crypto-js historically accepts wrong passwords and returns garbage. The
  // encrypt() side refused to encrypt anything shorter than the minimum
  // plaintext length, so treat undersized output as a decrypt failure.
  if (str && str.length < MIN_PLAINTEXT_LEN) return false;
  return str;
}

export function encrypt(data: string, password: string): string {
  if (data.length < MIN_PLAINTEXT_LEN) throw new Error('data length cant be < ' + MIN_PLAINTEXT_LEN);
  return encryptV1(data, password);
}

export function decrypt(data: string, password: string): string | false {
  if (typeof data !== 'string' || data.length === 0) return false;
  if (data.startsWith(V1_PREFIX)) return decryptV1(data, password);
  return decryptLegacy(data, password);
}

export function isLegacyCiphertext(data: string): boolean {
  return typeof data === 'string' && data.length > 0 && !data.startsWith(V1_PREFIX);
}
