// blockExplorer.ts
import DefaultPreference from 'react-native-default-preference';
import {
  AVAILABLE_HCASH_PROFILES,
  BLOCK_EXPLORER_PROFILE_NAMES,
  BLOCK_EXPLORER_PROFILES,
  DEFAULT_BLOCK_EXPLORER_NAME,
  DEFAULT_BLOCK_EXPLORER_URL,
} from '../blue_modules/hashcash';

export interface BlockExplorer {
  key: string;
  name: string;
  url: string;
}

export const BLOCK_EXPLORERS: { [key: string]: BlockExplorer } = {
  default: { key: 'default', name: DEFAULT_BLOCK_EXPLORER_NAME, url: DEFAULT_BLOCK_EXPLORER_URL },
  ...(AVAILABLE_HCASH_PROFILES.includes('testnet')
    ? { hcashTestnet: { key: 'hcashTestnet', name: BLOCK_EXPLORER_PROFILE_NAMES.testnet, url: BLOCK_EXPLORER_PROFILES.testnet } }
    : {}),
  ...(AVAILABLE_HCASH_PROFILES.includes('local')
    ? { hcashLocal: { key: 'hcashLocal', name: BLOCK_EXPLORER_PROFILE_NAMES.local, url: BLOCK_EXPLORER_PROFILES.local } }
    : {}),
  custom: { key: 'custom', name: 'Custom', url: '' }, // Custom URL will be handled separately
};

export const getBlockExplorersList = (): BlockExplorer[] => {
  const uniqueByUrl = new Set<string>();
  const explorers: BlockExplorer[] = [];

  for (const explorer of Object.values(BLOCK_EXPLORERS)) {
    if (explorer.key === 'custom') {
      explorers.push(explorer);
      continue;
    }

    const normalizedUrl = normalizeUrl(explorer.url);
    if (uniqueByUrl.has(normalizedUrl)) {
      continue;
    }

    uniqueByUrl.add(normalizedUrl);
    explorers.push(explorer);
  }

  return explorers;
};

export const normalizeUrl = (url: string): string => {
  return url.replace(/\/+$/, '');
};

export const isValidUrl = (url: string): boolean => {
  const pattern = /^(https?:\/\/)/;
  return pattern.test(url);
};

export const findMatchingExplorerByDomain = (url: string): BlockExplorer | null => {
  const domain = getDomain(url);
  for (const explorer of Object.values(BLOCK_EXPLORERS)) {
    if (getDomain(explorer.url) === domain) {
      return explorer;
    }
  }
  return null;
};

export const getDomain = (url: string): string => {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const BLOCK_EXPLORER_STORAGE_KEY = 'blockExplorer';
const CUSTOM_BLOCK_EXPLORER_ENABLED = typeof __DEV__ === 'boolean' && __DEV__;

export const saveBlockExplorer = async (url: string): Promise<boolean> => {
  try {
    await DefaultPreference.set(BLOCK_EXPLORER_STORAGE_KEY, url);
    return true;
  } catch (error) {
    console.error('Error saving block explorer:', error);
    return false;
  }
};

export const removeBlockExplorer = async (): Promise<boolean> => {
  try {
    await DefaultPreference.clear(BLOCK_EXPLORER_STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Error removing block explorer:', error);
    return false;
  }
};

export const getBlockExplorerUrl = async (): Promise<string> => {
  try {
    if (!CUSTOM_BLOCK_EXPLORER_ENABLED) {
      return BLOCK_EXPLORERS.default.url;
    }

    const url = (await DefaultPreference.get(BLOCK_EXPLORER_STORAGE_KEY)) as string | null;
    return url ?? BLOCK_EXPLORERS.default.url;
  } catch (error) {
    console.error('Error getting block explorer:', error);
    return BLOCK_EXPLORERS.default.url;
  }
};
