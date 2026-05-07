import * as bitcoin from 'bitcoinjs-lib';

export const HASHCASH_URI_SCHEME = 'hcash';
export const HASHCASH_ADDRESS_PREFIX = 'hcash1';
export const LIGHTNING_ENABLED = false;
export const DONATE_ENABLED = false;
export const CURRENCY_SETTINGS_ENABLED = false;
export const CLIPBOARD_AUTO_READ_ENABLED = false;

export type HcashProfile = 'local' | 'dev';

export type HcashElectrumPeer = {
  host: string;
  ssl?: number;
  tcp?: number;
};

const IS_DEV_BUILD = typeof __DEV__ === 'boolean' && __DEV__;

const PROFILE_ENDPOINTS: Record<HcashProfile, { explorer: string; explorerApiBase: string; electrum: HcashElectrumPeer }> = {
  local: {
    explorer: 'http://127.0.0.1:18080',
    explorerApiBase: 'http://127.0.0.1:18080/api',
    electrum: { host: '127.0.0.1', ssl: 50002, tcp: 50001 },
  },
  dev: {
    explorer: 'https://explorer.hashcash-test.network',
    explorerApiBase: 'https://explorer.hashcash-test.network/api',
    electrum: { host: 'electrum.hashcash-test.network', ssl: 50002, tcp: 50001 },
  },
};

const resolveProfile = (): HcashProfile => {
  if (!IS_DEV_BUILD) return 'dev';
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const raw = (runtimeProcess?.env?.HCASH_WALLET_PROFILE || '').toLowerCase();
  if (raw === 'local') return 'local';
  return 'dev';
};

export const ACTIVE_HCASH_PROFILE: HcashProfile = resolveProfile();
export const DEFAULT_BLOCK_EXPLORER_URL = PROFILE_ENDPOINTS[ACTIVE_HCASH_PROFILE].explorer;
export const DEFAULT_BLOCK_EXPLORER_API_BASE = PROFILE_ENDPOINTS[ACTIVE_HCASH_PROFILE].explorerApiBase;

export const BLOCK_EXPLORER_PROFILES: Record<HcashProfile, string> = {
  dev: PROFILE_ENDPOINTS.dev.explorer,
  local: PROFILE_ENDPOINTS.local.explorer,
};

export const AVAILABLE_HCASH_PROFILES: HcashProfile[] = IS_DEV_BUILD ? ['dev', 'local'] : ['dev'];

export const DEFAULT_ELECTRUM_PEER: HcashElectrumPeer = PROFILE_ENDPOINTS[ACTIVE_HCASH_PROFILE].electrum;

const electrumPeersByProfile: Record<HcashProfile, HcashElectrumPeer[]> = {
  local: [PROFILE_ENDPOINTS.local.electrum],
  dev: [PROFILE_ENDPOINTS.dev.electrum],
};

const suggestedElectrumPeers: HcashElectrumPeer[] = IS_DEV_BUILD
  ? [PROFILE_ENDPOINTS.dev.electrum, PROFILE_ENDPOINTS.local.electrum]
  : [PROFILE_ENDPOINTS.dev.electrum];

// Keep unique peers while preserving deterministic order.
const dedupePeerKey = (peer: HcashElectrumPeer): string => `${peer.host}:${peer.ssl ?? peer.tcp ?? ''}`;
export const HCASH_ELECTRUM_PEERS: HcashElectrumPeer[] = electrumPeersByProfile[ACTIVE_HCASH_PROFILE].filter((peer, idx, arr) => {
  const key = dedupePeerKey(peer);
  return arr.findIndex(candidate => dedupePeerKey(candidate) === key) === idx;
});

export const HCASH_SUGGESTED_ELECTRUM_PEERS: HcashElectrumPeer[] = [DEFAULT_ELECTRUM_PEER, ...suggestedElectrumPeers].filter(
  (peer, idx, arr) => {
    const key = dedupePeerKey(peer);
    return arr.findIndex(candidate => dedupePeerKey(candidate) === key) === idx;
  },
);

export const HASHCASH_NETWORK: bitcoin.Network = {
  messagePrefix: '\x18HashCash Signed Message:\n',
  bech32: 'hcash',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 28,
  scriptHash: 88,
  wif: 212,
};

let networkInitialized = false;
export const ensureHashcashNetwork = (): void => {
  if (networkInitialized) return;
  Object.assign(bitcoin.networks.bitcoin, HASHCASH_NETWORK);
  networkInitialized = true;
};

export const hasHcashUriScheme = (value: string): boolean => value.trim().toLowerCase().startsWith(`${HASHCASH_URI_SCHEME}:`);

export const stripHcashUriPrefix = (value: string): string =>
  value
    .replace('://', ':')
    .replace(/^hcash:/i, '')
    .replace(/^hcash=/i, '')
    .split('?')[0];

export const toHcashUri = (address: string): string => `${HASHCASH_URI_SCHEME}:${address}`;

export const isHcashAddress = (value: string): boolean => value.trim().toLowerCase().startsWith(HASHCASH_ADDRESS_PREFIX);

ensureHashcashNetwork();
