import BigNumber from 'bignumber.js';
import * as bitcoin from 'bitcoinjs-lib';
import DefaultPreference from 'react-native-default-preference';
import RNFS from 'react-native-fs';
import Realm from 'realm';
import { sha256 as _sha256 } from '@noble/hashes/sha256';

import { LegacyWallet, SegwitBech32Wallet, SegwitP2SHWallet, TaprootWallet } from '../class';
import presentAlert from '../components/Alert';
import loc from '../loc';
import { GROUP_IO_BLUEWALLET } from './currency';
import { ElectrumServerItem } from '../screen/settings/ElectrumSettings';
import { triggerWarningHapticFeedback } from './hapticFeedback';
import { AlertButton } from 'react-native';
import { uint8ArrayToHex, stringToUint8Array, hexToUint8Array } from './uint8array-extras/index';
import {
  DEFAULT_BLOCK_EXPLORER_API_BASE,
  DEFAULT_ELECTRUM_PEER,
  HCASH_ELECTRUM_PEERS,
  HCASH_SUGGESTED_ELECTRUM_PEERS,
  HASHCASH_NETWORK,
} from './hashcash';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

type Utxo = {
  height: number;
  value: number;
  address: string;
  txid: string;
  vout: number;
  wif?: string;
};

type ElectrumTransaction = {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    scriptSig: { asm: string; hex: string };
    txinwitness: string[];
    sequence: number;
    addresses?: string[];
    value?: number;
  }[];
  vout: {
    value: number;
    n: number;
    scriptPubKey: {
      asm: string;
      hex: string;
      reqSigs: number;
      type: string;
      addresses: string[];
    };
  }[];
  blockhash: string;
  confirmations: number;
  time: number;
  blocktime: number;
};

type ElectrumTransactionWithHex = ElectrumTransaction & {
  hex: string;
};

type MempoolTransaction = {
  height: 0;
  tx_hash: string;
  fee: number;
};

type Peer = {
  host: string;
  ssl?: number;
  tcp?: number;
};

export const ELECTRUM_HOST = 'electrum_host';
export const ELECTRUM_TCP_PORT = 'electrum_tcp_port';
export const ELECTRUM_SSL_PORT = 'electrum_ssl_port';
export const ELECTRUM_SERVER_HISTORY = 'electrum_server_history';
const ELECTRUM_CONNECTION_DISABLED = 'electrum_disabled';
const storageKey = 'ELECTRUM_PEERS';
const defaultPeer: Peer = DEFAULT_ELECTRUM_PEER;
export const hardcodedPeers: Peer[] = HCASH_ELECTRUM_PEERS;
const CUSTOM_ELECTRUM_SERVER_ENABLED = typeof __DEV__ === 'boolean' && __DEV__;

export const suggestedServers: Peer[] = HCASH_SUGGESTED_ELECTRUM_PEERS.map(peer => ({
  ...peer,
}));

let mainClient: typeof ElectrumClient | undefined;
let mainConnected: boolean = false;
let wasConnectedAtLeastOnce: boolean = false;
let serverName: string | false = false;
let disableBatching: boolean = false;
let connectionAttempt: number = 0;
let currentPeerIndex = hardcodedPeers.findIndex(peer => peer.host === defaultPeer.host && peer.ssl === defaultPeer.ssl);
if (currentPeerIndex < 0) currentPeerIndex = 0;
let preferredPeerFailureCount: number = 0;
const MAX_PREFERRED_PEER_FAILURES = 2;
let latestBlock: { height: number; time: number } | { height: undefined; time: undefined } = { height: undefined, time: undefined };
const txhashHeightCache: Record<string, number> = {};
const scripthashHistoryCache: Record<string, ElectrumHistory[]> = {};
const blockTimestampCache: Record<number, number> = {};
const pendingBlockTimestampRequests: Partial<Record<number, Promise<number | undefined>>> = {};
const BLOCK_HEADER_TIMESTAMP_OFFSET = 68;
const BLOCK_HEADER_TIMESTAMP_SIZE = 4;
const ELECTRUM_HISTORY_ENTRY_SOFT_LIMIT = 1000;
const EXPLORER_HISTORY_PAGE_SIZE = 25;
const EXPLORER_HISTORY_MAX_PAGES = 400;
let _realm: Realm | undefined;

function bitcoinjs_crypto_sha256(buffer: Uint8Array): Uint8Array {
  return _sha256(buffer);
}

function extractHeaderHex(header: unknown): string | undefined {
  if (typeof header === 'string') return header;
  if (!header || typeof header !== 'object') return undefined;

  const parsedHeader = header as { hex?: unknown; header?: unknown };
  if (typeof parsedHeader.hex === 'string') return parsedHeader.hex;
  if (typeof parsedHeader.header === 'string') return parsedHeader.header;
  return undefined;
}

function extractBlockTimestampFromHeaderHex(headerHex?: string): number | undefined {
  if (!headerHex || typeof headerHex !== 'string') return undefined;
  const bytes = hexToUint8Array(headerHex);
  if (bytes.length < BLOCK_HEADER_TIMESTAMP_OFFSET + BLOCK_HEADER_TIMESTAMP_SIZE) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(BLOCK_HEADER_TIMESTAMP_OFFSET, true);
}

async function getBlockTimestampByHeight(height?: number): Promise<number | undefined> {
  if (!mainClient || !height || height <= 0) return undefined;

  if (blockTimestampCache[height]) return blockTimestampCache[height];
  if (pendingBlockTimestampRequests[height]) return pendingBlockTimestampRequests[height];

  pendingBlockTimestampRequests[height] = (async () => {
    try {
      const header = await mainClient?.blockchainBlock_header(height);
      const timestamp = extractBlockTimestampFromHeaderHex(extractHeaderHex(header));
      if (timestamp) {
        blockTimestampCache[height] = timestamp;
        return timestamp;
      }
    } catch (error) {
      console.debug('Failed to fetch block header timestamp', height, String(error));
    }
    return undefined;
  })();

  try {
    return await pendingBlockTimestampRequests[height];
  } finally {
    delete pendingBlockTimestampRequests[height];
  }
}

async function _getRealm() {
  if (_realm) return _realm;

  const cacheFolderPath = RNFS.CachesDirectoryPath; // Path to cache folder
  const password = uint8ArrayToHex(bitcoinjs_crypto_sha256(stringToUint8Array('fyegjitkyf[eqjnc.lf')));
  const buf = hexToUint8Array(password + password);
  const encryptionKey = Int8Array.from(buf);
  const path = `${cacheFolderPath}/electrumcache.realm`; // Use cache folder path

  const schema = [
    {
      name: 'Cache',
      primaryKey: 'cache_key',
      properties: {
        cache_key: { type: 'string', indexed: true },
        cache_value: 'string', // stringified json
      },
    },
  ];

  // @ts-ignore schema doesn't match Realm's schema type
  _realm = await Realm.open({
    schema,
    path,
    encryptionKey,
    excludeFromIcloudBackup: true,
  });

  return _realm;
}

export const getPreferredServer = async (): Promise<ElectrumServerItem | undefined> => {
  try {
    if (!CUSTOM_ELECTRUM_SERVER_ENABLED) {
      return {
        host: defaultPeer.host,
        tcp: defaultPeer.tcp,
        ssl: defaultPeer.ssl,
      };
    }

    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const host = (await DefaultPreference.get(ELECTRUM_HOST)) as string;
    const tcpPort = await DefaultPreference.get(ELECTRUM_TCP_PORT);
    const sslPort = await DefaultPreference.get(ELECTRUM_SSL_PORT);

    console.log('Getting preferred server:', { host, tcpPort, sslPort });

    if (!host) {
      console.warn('Preferred server host is undefined');
      return;
    }

    return {
      host,
      tcp: tcpPort ? Number(tcpPort) : undefined,
      ssl: sslPort ? Number(sslPort) : undefined,
    };
  } catch (error) {
    console.error('Error in getPreferredServer:', error);
    return undefined;
  }
};

export const removePreferredServer = async () => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    console.log('Removing preferred server');
    await DefaultPreference.clear(ELECTRUM_HOST);
    await DefaultPreference.clear(ELECTRUM_TCP_PORT);
    await DefaultPreference.clear(ELECTRUM_SSL_PORT);
  } catch (error) {
    console.error('Error in removePreferredServer:', error);
  }
};

export async function isDisabled(): Promise<boolean> {
  let result;
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const savedValue = await DefaultPreference.get(ELECTRUM_CONNECTION_DISABLED);
    console.log('Getting Electrum connection disabled state:', savedValue);
    if (savedValue === null) {
      result = false;
    } else {
      result = savedValue;
    }
  } catch (error) {
    console.error('Error getting Electrum connection disabled state:', error);
    result = false;
  }
  return !!result;
}

export async function setDisabled(disabled = true) {
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  console.log('Setting Electrum connection disabled state to:', disabled);
  return DefaultPreference.set(ELECTRUM_CONNECTION_DISABLED, disabled ? '1' : '');
}

function getCurrentPeer() {
  return hardcodedPeers[currentPeerIndex];
}

/**
 * Returns NEXT hardcoded electrum server (increments index after use)
 */
function getNextPeer() {
  const peer = getCurrentPeer();
  currentPeerIndex++;
  if (currentPeerIndex >= hardcodedPeers.length) currentPeerIndex = 0;
  return peer;
}

async function getSavedPeer(): Promise<Peer | null> {
  try {
    if (!CUSTOM_ELECTRUM_SERVER_ENABLED) return null;

    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const host = (await DefaultPreference.get(ELECTRUM_HOST)) as string;
    const tcpPort = await DefaultPreference.get(ELECTRUM_TCP_PORT);
    const sslPort = await DefaultPreference.get(ELECTRUM_SSL_PORT);

    console.log('Getting saved peer:', { host, tcpPort, sslPort });

    if (!host) {
      return null;
    }

    if (sslPort) {
      return { host, ssl: Number(sslPort) };
    }

    if (tcpPort) {
      return { host, tcp: Number(tcpPort) };
    }

    return null;
  } catch (error) {
    console.error('Error in getSavedPeer:', error);
    return null;
  }
}

export async function connectMain(): Promise<void> {
  if (await isDisabled()) {
    console.log('Electrum connection disabled by user. Skipping connectMain call');
    return;
  }
  if (mainConnected && mainClient) {
    return;
  }
  if (mainClient && !mainConnected) {
    console.log('Electrum connection attempt already in progress; skipping duplicate connectMain call');
    return;
  }

  let usingPeer = getNextPeer();
  let usingPreferredPeer = false;
  const savedPeer = await getSavedPeer();
  if (savedPeer && savedPeer.host && (savedPeer.tcp || savedPeer.ssl) && preferredPeerFailureCount < MAX_PREFERRED_PEER_FAILURES) {
    usingPeer = savedPeer;
    usingPreferredPeer = true;
  }

  console.log('Using peer:', JSON.stringify(usingPeer));

  try {
    console.log('begin connection:', JSON.stringify(usingPeer));
    mainClient = new ElectrumClient(net, tls, usingPeer.ssl || usingPeer.tcp, usingPeer.host, usingPeer.ssl ? 'tls' : 'tcp');

    mainClient.onError = function (e: { message: string }) {
      console.log('electrum mainClient.onError():', e.message);
      if (mainConnected) {
        // most likely got a timeout from electrum ping. lets reconnect
        // but only if we were previously connected (mainConnected), otherwise theres other
        // code which does connection retries
        mainClient?.close();
        mainClient = undefined;
        mainConnected = false;
        // dropping `mainConnected` flag ensures there wont be reconnection race condition if several
        // errors triggered
        console.log('reconnecting after socket error');
        setTimeout(connectMain, usingPeer.host.endsWith('.onion') ? 4000 : 500);
      }
    };
    const ver = await mainClient.initElectrum({ client: 'bluewallet', version: '1.4' });
    if (ver && ver[0]) {
      console.log('connected to ', ver);
      serverName = ver[0];
      mainConnected = true;
      wasConnectedAtLeastOnce = true;
      connectionAttempt = 0;
      preferredPeerFailureCount = 0;
      if (ver[0].startsWith('ElectrumPersonalServer') || ver[0].startsWith('electrs') || ver[0].startsWith('Fulcrum')) {
        disableBatching = true;

        // exeptions for versions:
        const [electrumImplementation, electrumVersion] = ver[0].split(' ');
        switch (electrumImplementation) {
          case 'electrs':
            if (semVerToInt(electrumVersion) >= semVerToInt('0.9.0')) {
              disableBatching = false;
            }
            break;
          case 'electrs-esplora':
            // its a different one, and it does NOT support batching
            // nop
            break;
          case 'Fulcrum':
            if (semVerToInt(electrumVersion) >= semVerToInt('1.9.0')) {
              disableBatching = false;
            }
            break;
        }
      }
      const header = await mainClient.blockchainHeaders_subscribe();
      if (header && header.height) {
        const headerTimestamp = extractBlockTimestampFromHeaderHex(extractHeaderHex(header));
        latestBlock = {
          height: header.height,
          time: headerTimestamp ?? Math.floor(+new Date() / 1000),
        };
        if (headerTimestamp) blockTimestampCache[header.height] = headerTimestamp;
      }
      // AsyncStorage.setItem(storageKey, JSON.stringify(peers));  TODO: refactor
    }
  } catch (e) {
    mainConnected = false;
    console.log('bad connection:', JSON.stringify(usingPeer), e);
    mainClient?.close();
    mainClient = undefined;
  }

  if (!mainConnected) {
    if (usingPreferredPeer) {
      preferredPeerFailureCount++;
      console.warn('Preferred Electrum peer failed', preferredPeerFailureCount, 'time(s)');
      if (preferredPeerFailureCount >= MAX_PREFERRED_PEER_FAILURES) {
        console.warn('Preferred Electrum peer is unhealthy; clearing saved server and falling back to profile peers');
        await removePreferredServer();
        connectionAttempt = 0;
        mainClient?.close();
        mainClient = undefined;
        await new Promise(resolve => setTimeout(resolve, 500));
        return connectMain();
      }
    }

    console.log('retry');
    connectionAttempt = connectionAttempt + 1;
    mainClient?.close();
    mainClient = undefined;
    if (connectionAttempt >= 5) {
      presentNetworkErrorAlert(usingPeer);
    } else {
      console.log('reconnection attempt #', connectionAttempt);
      await new Promise(resolve => setTimeout(resolve, 500)); // sleep
      return connectMain();
    }
  }
}

export async function presentResetToDefaultsAlert(): Promise<boolean> {
  const hasPreferredServer = await getPreferredServer();
  const serverHistoryStr = await DefaultPreference.get(ELECTRUM_SERVER_HISTORY);
  const serverHistory = typeof serverHistoryStr === 'string' ? JSON.parse(serverHistoryStr) : [];
  return new Promise(resolve => {
    triggerWarningHapticFeedback();

    const buttons: AlertButton[] = [];

    if (hasPreferredServer?.host && (hasPreferredServer.tcp || hasPreferredServer.ssl)) {
      buttons.push({
        text: loc.settings.electrum_reset,
        onPress: async () => {
          try {
            await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
            await DefaultPreference.clear(ELECTRUM_HOST);
            await DefaultPreference.clear(ELECTRUM_SSL_PORT);
            await DefaultPreference.clear(ELECTRUM_TCP_PORT);
          } catch (e) {
            console.log(e); // Must be running on Android
          }
          resolve(true);
        },
        style: 'default',
      });
    }

    if (serverHistory.length > 0) {
      buttons.push({
        text: loc.settings.electrum_reset_to_default_and_clear_history,
        onPress: async () => {
          try {
            await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
            await DefaultPreference.clear(ELECTRUM_SERVER_HISTORY);
            await DefaultPreference.clear(ELECTRUM_HOST);
            await DefaultPreference.clear(ELECTRUM_SSL_PORT);
            await DefaultPreference.clear(ELECTRUM_TCP_PORT);
          } catch (e) {
            console.log(e); // Must be running on Android
          }
          resolve(true);
        },
        style: 'destructive',
      });
    }

    buttons.push({
      text: loc._.cancel,
      onPress: () => resolve(false),
      style: 'cancel',
    });

    presentAlert({
      title: loc.settings.electrum_reset,
      message: loc.settings.electrum_reset_to_default,
      buttons,
      options: { cancelable: true },
    });
  });
}

const presentNetworkErrorAlert = async (usingPeer?: Peer) => {
  if (await isDisabled()) {
    console.log(
      'Electrum connection disabled by user. Perhaps we are attempting to show this network error alert after the user disabled connections.',
    );
    return;
  }

  presentAlert({
    allowRepeat: false,
    title: loc.errors.network,
    message: loc.formatString(
      usingPeer ? loc.settings.electrum_unable_to_connect : loc.settings.electrum_error_connect,
      usingPeer ? { server: `${usingPeer.host}:${usingPeer.ssl ?? usingPeer.tcp}` } : {},
    ),
    buttons: [
      {
        text: loc.wallets.list_tryagain,
        onPress: () => {
          connectionAttempt = 0;
          mainClient?.close();
          mainClient = undefined;
          setTimeout(connectMain, 500);
        },
        style: 'default',
      },
      {
        text: loc.settings.electrum_reset,
        onPress: () => {
          presentResetToDefaultsAlert().then(result => {
            if (result) {
              connectionAttempt = 0;
              mainClient?.close();
              mainClient = undefined;
              setTimeout(connectMain, 500);
            }
          });
        },
        style: 'destructive',
      },
      {
        text: loc._.cancel,
        onPress: () => {
          connectionAttempt = 0;
          mainClient?.close();
          mainClient = undefined;
        },
        style: 'cancel',
      },
    ],
    options: { cancelable: false },
  });
};

/**
 * Returns random electrum server out of list of servers
 * previous electrum server told us. Nearly half of them is
 * usually offline.
 * Not used for now.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getRandomDynamicPeer(): Promise<Peer> {
  try {
    let peers = JSON.parse((await DefaultPreference.get(storageKey)) as string);
    peers = peers.sort(() => Math.random() - 0.5); // shuffle
    for (const peer of peers) {
      const ret: Peer = { host: peer[0], ssl: peer[1] };
      ret.host = peer[1];

      if (peer[1] === 's') {
        ret.ssl = peer[2];
      } else {
        ret.tcp = peer[2];
      }

      for (const item of peer[2]) {
        if (item.startsWith('t')) {
          ret.tcp = item.replace('t', '');
        }
      }
      if (ret.host && ret.tcp) return ret;
    }

    return defaultPeer; // failed to find random client, using default
  } catch (_) {
    return defaultPeer; // smth went wrong, using default
  }
}

export const getBalanceByAddress = async function (address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  try {
    if (!mainClient) throw new Error('Electrum client is not connected');
    const script = bitcoin.address.toOutputScript(address, HASHCASH_NETWORK);
    const hash = bitcoinjs_crypto_sha256(script);
    const reversedHash = new Uint8Array(hash).reverse();
    const balance = await mainClient.blockchainScripthash_getBalance(uint8ArrayToHex(reversedHash));
    balance.addr = address;
    return balance;
  } catch (error) {
    console.error('Error in getBalanceByAddress:', error);
    throw error;
  }
};

export const getConfig = async function () {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return {
    host: mainClient.host,
    port: mainClient.port,
    serverName,
    connected: mainClient.timeLastCall !== 0 && mainClient.status,
  };
};

export const getSecondsSinceLastRequest = function () {
  return mainClient && mainClient.timeLastCall ? (+new Date() - mainClient.timeLastCall) / 1000 : -1;
};

export const getTransactionsByAddress = async function (address: string): Promise<ElectrumHistory[]> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address, HASHCASH_NETWORK);
  const hash = bitcoinjs_crypto_sha256(script);
  const reversedHash = new Uint8Array(hash).reverse();
  const history = await mainClient.blockchainScripthash_getHistory(uint8ArrayToHex(reversedHash));
  for (const h of history || []) {
    if (h.tx_hash) txhashHeightCache[h.tx_hash] = h.height; // cache tx height
  }

  return history;
};

export const getMempoolTransactionsByAddress = async function (address: string): Promise<MempoolTransaction[]> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address, HASHCASH_NETWORK);
  const hash = bitcoinjs_crypto_sha256(script);
  const reversedHash = new Uint8Array(hash).reverse();
  return mainClient.blockchainScripthash_getMempool(uint8ArrayToHex(reversedHash));
};

export const ping = async function () {
  try {
    await mainClient.server_ping();
    return true;
  } catch (_) {}

  mainConnected = false;
  return false;
};

// exported only to be used in unit tests
export function txhexToElectrumTransaction(
  txhex: string,
  options: { blockHeight?: number; blockTimestamp?: number } = {},
): ElectrumTransactionWithHex {
  const tx = bitcoin.Transaction.fromHex(txhex);

  const ret: ElectrumTransactionWithHex = {
    txid: tx.getId(),
    hash: tx.getId(),
    version: tx.version,
    size: Math.ceil(txhex.length / 2),
    vsize: tx.virtualSize(),
    weight: tx.weight(),
    locktime: tx.locktime,
    vin: [],
    vout: [],
    hex: txhex,
    blockhash: '',
    confirmations: 0,
    time: 0,
    blocktime: 0,
  };

  const txBlockHeight = options.blockHeight ?? txhashHeightCache[ret.txid];
  if (txBlockHeight && txBlockHeight > 0) {
    // got blockheight where this tx was confirmed
    ret.confirmations = estimateCurrentBlockheight() - txBlockHeight;
    if (ret.confirmations < 0) {
      // ugly fix for when estimator lags behind
      ret.confirmations = 1;
    }
    const now = Math.floor(+new Date() / 1000);
    const knownBlockTimestamp = options.blockTimestamp ?? blockTimestampCache[txBlockHeight];
    const safeBlockTimestamp =
      knownBlockTimestamp && knownBlockTimestamp > 0 ? knownBlockTimestamp : Math.min(calculateBlockTime(txBlockHeight), now);
    ret.time = safeBlockTimestamp;
    ret.blocktime = safeBlockTimestamp;
  }

  for (const inn of tx.ins) {
    const txinwitness = [];
    if (inn.witness[0]) txinwitness.push(uint8ArrayToHex(inn.witness[0]));
    if (inn.witness[1]) txinwitness.push(uint8ArrayToHex(inn.witness[1]));

    ret.vin.push({
      txid: uint8ArrayToHex(new Uint8Array(inn.hash).reverse()),
      vout: inn.index,
      scriptSig: { hex: uint8ArrayToHex(inn.script), asm: '' },
      txinwitness,
      sequence: inn.sequence,
    });
  }

  let n = 0;
  for (const out of tx.outs) {
    const value = new BigNumber(out.value).dividedBy(100000000).toNumber();
    const scriptHex = uint8ArrayToHex(out.script);
    let address: false | string = false;
    let type: string = 'nonstandard';

    try {
      // Supports all standard script types known by bitcoinjs (including p2wsh/p2tr),
      // and avoids dropping whole transactions when one output is nonstandard.
      address = bitcoin.address.fromOutputScript(out.script, HASHCASH_NETWORK);
      type = 'standard';
    } catch (_) {
      // Fallback for compatibility with custom script conversion helpers.
      if (SegwitBech32Wallet.scriptPubKeyToAddress(scriptHex)) {
        address = SegwitBech32Wallet.scriptPubKeyToAddress(scriptHex);
        type = 'witness_v0_keyhash';
      } else if (SegwitP2SHWallet.scriptPubKeyToAddress(scriptHex)) {
        address = SegwitP2SHWallet.scriptPubKeyToAddress(scriptHex);
        type = 'scripthash';
      } else if (LegacyWallet.scriptPubKeyToAddress(scriptHex)) {
        address = LegacyWallet.scriptPubKeyToAddress(scriptHex);
        type = 'pubkeyhash';
      } else if (TaprootWallet.scriptPubKeyToAddress(scriptHex)) {
        address = TaprootWallet.scriptPubKeyToAddress(scriptHex);
        type = 'witness_v1_taproot';
      }
    }

    ret.vout.push({
      value,
      n,
      scriptPubKey: {
        asm: '',
        hex: scriptHex,
        reqSigs: 1, // todo
        type,
        addresses: address ? [address] : [],
      },
    });
    n++;
  }
  return ret;
}

async function decodeTxHexWithChainMetadata(
  txhex: string,
  options: { txidHint?: string; blockHeight?: number } = {},
): Promise<ElectrumTransactionWithHex> {
  const blockHeight = options.blockHeight ?? (options.txidHint ? txhashHeightCache[options.txidHint] : undefined);
  const blockTimestamp = blockHeight && blockHeight > 0 ? await getBlockTimestampByHeight(blockHeight) : undefined;
  return txhexToElectrumTransaction(txhex, { blockHeight, blockTimestamp });
}

export const getTransactionsFullByAddress = async (address: string): Promise<ElectrumTransaction[]> => {
  const txs = await getTransactionsByAddress(address);
  const blockHeights = [...new Set((txs || []).map(tx => tx.height).filter(height => height > 0))];
  await Promise.all(blockHeights.map(height => getBlockTimestampByHeight(height)));
  const ret: ElectrumTransaction[] = [];
  for (const tx of txs) {
    let full;
    try {
      full = await mainClient.blockchainTransaction_get(tx.tx_hash, true);
    } catch (error: any) {
      if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
        // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
        // throwing a proper exception. lets fetch txhex manually and decode on our end
        const txhex = await mainClient.blockchainTransaction_get(tx.tx_hash, false);
        full = await decodeTxHexWithChainMetadata(txhex, { txidHint: tx.tx_hash, blockHeight: tx.height });
      } else {
        // nope, its something else
        throw new Error(String(error?.message ?? error));
      }
    }
    full.address = address;
    for (const input of full.vin) {
      // now we need to fetch previous TX where this VIN became an output, so we can see its amount
      let prevTxForVin;
      try {
        prevTxForVin = await mainClient.blockchainTransaction_get(input.txid, true);
      } catch (error: any) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
          // throwing a proper exception. lets fetch txhex manually and decode on our end
          const txhex = await mainClient.blockchainTransaction_get(input.txid, false);
          prevTxForVin = await decodeTxHexWithChainMetadata(txhex, { txidHint: input.txid });
        } else {
          // nope, its something else
          throw new Error(String(error?.message ?? error));
        }
      }
      if (prevTxForVin && prevTxForVin.vout && prevTxForVin.vout[input.vout]) {
        input.value = prevTxForVin.vout[input.vout].value;
        // also, we extract destination address from prev output:
        if (prevTxForVin.vout[input.vout].scriptPubKey && prevTxForVin.vout[input.vout].scriptPubKey.addresses) {
          input.addresses = prevTxForVin.vout[input.vout].scriptPubKey.addresses;
        }
        // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
        if (prevTxForVin.vout[input.vout]?.scriptPubKey?.address) {
          input.addresses = [prevTxForVin.vout[input.vout].scriptPubKey.address];
        }
      }
    }

    for (const output of full.vout) {
      if (output?.scriptPubKey && output.scriptPubKey.addresses) output.addresses = output.scriptPubKey.addresses;
      // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
      if (output?.scriptPubKey?.address) output.addresses = [output.scriptPubKey.address];
    }
    full.inputs = full.vin;
    full.outputs = full.vout;
    delete full.vin;
    delete full.vout;
    delete full.hex; // compact
    delete full.hash; // compact
    ret.push(full);
  }

  return ret;
};

type MultiGetBalanceResponse = {
  balance: number;
  unconfirmed_balance: number;
  addresses: Record<string, { confirmed: number; unconfirmed: number }>;
};

export const multiGetBalanceByAddress = async (addresses: string[], batchsize: number = 200): Promise<MultiGetBalanceResponse> => {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret = {
    balance: 0,
    unconfirmed_balance: 0,
    addresses: {} as Record<string, { confirmed: number; unconfirmed: number }>,
  };

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr, HASHCASH_NETWORK);
      const hash = bitcoinjs_crypto_sha256(script);
      const reversedHash = uint8ArrayToHex(new Uint8Array(hash).reverse());
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let balances = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash: Record<number, string> = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        promises.push(mainClient.blockchainScripthash_getBalance(scripthashes[promiseIndex]));
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
      }
      const promiseResults = await Promise.all(promises);
      for (let resultIndex = 0; resultIndex < promiseResults.length; resultIndex++) {
        balances.push({ result: promiseResults[resultIndex], param: index2scripthash[resultIndex] });
      }
    } else {
      balances = await mainClient.blockchainScripthash_getBalanceBatch(scripthashes);
    }

    for (const bal of balances) {
      if (bal.error) console.warn('multiGetBalanceByAddress():', bal.error);
      ret.balance += +bal.result.confirmed;
      ret.unconfirmed_balance += +bal.result.unconfirmed;
      ret.addresses[scripthash2addr[bal.param]] = bal.result;
    }
  }

  return ret;
};

export const multiGetUtxoByAddress = async function (addresses: string[], batchsize: number = 100): Promise<Record<string, Utxo[]>> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: Record<string, any> = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr, HASHCASH_NETWORK);
      const hash = bitcoinjs_crypto_sha256(script);
      const reversedHash = uint8ArrayToHex(new Uint8Array(hash).reverse());
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      const utxosResults = await Promise.allSettled(
        scripthashes.map(scripthash => mainClient.blockchainScripthash_listunspent(scripthash)),
      );
      for (let utxoIndex = 0; utxoIndex < utxosResults.length; utxoIndex++) {
        const scripthash = scripthashes[utxoIndex];
        const utxoResult = utxosResults[utxoIndex];
        if (utxoResult.status === 'fulfilled') {
          results.push({ result: utxoResult.value, param: scripthash });
        } else {
          const errorMessage = String((utxoResult.reason as Error)?.message ?? utxoResult.reason ?? 'Unknown utxo error');
          console.warn('multiGetUtxoByAddress():', errorMessage, '; using empty list for', scripthash2addr[scripthash]);
          results.push({ result: [], param: scripthash });
        }
      }
    } else {
      results = await mainClient.blockchainScripthash_listunspentBatch(scripthashes);
    }

    for (const utxos of results) {
      ret[scripthash2addr[utxos.param]] = utxos.result;
      for (const utxo of ret[scripthash2addr[utxos.param]]) {
        utxo.address = scripthash2addr[utxos.param];
        utxo.txid = utxo.tx_hash;
        utxo.vout = utxo.tx_pos;
        delete utxo.tx_pos;
        delete utxo.tx_hash;
      }
    }
  }

  return ret;
};

export type ElectrumHistory = {
  tx_hash: string;
  height: number;
  address: string;
};

function getErrorMessage(error: unknown): string {
  return String((error as Error)?.message ?? error ?? 'Unknown history error');
}

function isTooManyHistoryEntriesError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('too many history entries') ||
    message.includes('history of > 1000 transactions') ||
    message.includes('history limit reached')
  );
}

function buildExplorerAddressHistoryUrl(address: string, lastSeenTxid?: string): string {
  const encodedAddress = encodeURIComponent(address);
  if (lastSeenTxid) {
    return `${DEFAULT_BLOCK_EXPLORER_API_BASE}/address/${encodedAddress}/txs/chain/${lastSeenTxid}`;
  }
  return `${DEFAULT_BLOCK_EXPLORER_API_BASE}/address/${encodedAddress}/txs`;
}

async function fetchAddressHistoryFromExplorer(address: string): Promise<ElectrumHistory[]> {
  const history: ElectrumHistory[] = [];
  const seenTxids = new Set<string>();
  let lastSeenTxid: string | undefined;

  for (let page = 0; page < EXPLORER_HISTORY_MAX_PAGES; page++) {
    const url = buildExplorerAddressHistoryUrl(address, lastSeenTxid);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Explorer history request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Array<{
      txid?: string;
      status?: { confirmed?: boolean; block_height?: number };
    }>;

    if (!Array.isArray(payload) || payload.length === 0) break;

    for (const tx of payload) {
      if (!tx || typeof tx.txid !== 'string' || seenTxids.has(tx.txid)) continue;
      seenTxids.add(tx.txid);
      const height = tx.status?.confirmed && typeof tx.status?.block_height === 'number' ? tx.status.block_height : 0;
      history.push({ tx_hash: tx.txid, height, address });
      if (tx.txid) txhashHeightCache[tx.txid] = height;
    }

    const tailTxid = payload[payload.length - 1]?.txid;
    if (payload.length < EXPLORER_HISTORY_PAGE_SIZE || typeof tailTxid !== 'string' || tailTxid === lastSeenTxid) {
      break;
    }
    lastSeenTxid = tailTxid;
  }

  return history;
}

export const multiGetHistoryByAddress = async function (
  addresses: string[],
  batchsize: number = 100,
): Promise<Record<string, ElectrumHistory[]>> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: Record<string, ElectrumHistory[]> = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr: Record<string, string> = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr, HASHCASH_NETWORK);
      const hash = bitcoinjs_crypto_sha256(script);
      const reversedHash = uint8ArrayToHex(new Uint8Array(hash).reverse());
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      const histories = await Promise.allSettled(scripthashes.map(scripthash => mainClient.blockchainScripthash_getHistory(scripthash)));
      for (let historyIndex = 0; historyIndex < histories.length; historyIndex++) {
        const scripthash = scripthashes[historyIndex];
        const historyResult = histories[historyIndex];
        if (historyResult.status === 'fulfilled') {
          results.push({ result: historyResult.value, param: scripthash });
        } else {
          const errorMessage = getErrorMessage(historyResult.reason);
          const cachedHistory = scripthashHistoryCache[scripthash];
          if (cachedHistory) {
            console.warn('multiGetHistoryByAddress():', errorMessage, '; using cached history for', scripthash2addr[scripthash]);
            results.push({ result: cachedHistory, param: scripthash });
            continue;
          }
          if (isTooManyHistoryEntriesError(errorMessage)) {
            try {
              const address = scripthash2addr[scripthash];
              if (!address) throw new Error('No address mapped for scripthash');
              const explorerHistory = await fetchAddressHistoryFromExplorer(address);
              console.warn(
                'multiGetHistoryByAddress():',
                errorMessage,
                '; using explorer fallback for',
                address,
                `(${explorerHistory.length} entries)`,
              );
              results.push({ result: explorerHistory, param: scripthash });
              continue;
            } catch (explorerError) {
              console.warn(
                'multiGetHistoryByAddress(): explorer fallback failed for',
                scripthash2addr[scripthash],
                getErrorMessage(explorerError),
              );
            }
          }
          throw new Error(errorMessage);
        }
      }
    } else {
      results = await mainClient.blockchainScripthash_getHistoryBatch(scripthashes);
    }

    for (const history of results) {
      if (history.error) {
        const errorMessage = getErrorMessage(history.error);
        const cachedHistory = scripthashHistoryCache[history.param];
        if (cachedHistory) {
          console.warn('multiGetHistoryByAddress():', errorMessage, '; using cached history for', scripthash2addr[history.param]);
          ret[scripthash2addr[history.param]] = cachedHistory.slice(0);
          continue;
        }
        if (isTooManyHistoryEntriesError(errorMessage)) {
          try {
            const address = scripthash2addr[history.param];
            if (!address) throw new Error('No address mapped for scripthash');
            const explorerHistory = await fetchAddressHistoryFromExplorer(address);
            console.warn(
              'multiGetHistoryByAddress():',
              errorMessage,
              '; using explorer fallback for',
              address,
              `(${explorerHistory.length} entries)`,
            );
            ret[address] = explorerHistory.slice(0);
            scripthashHistoryCache[history.param] = explorerHistory.slice(0);
            continue;
          } catch (explorerError) {
            console.warn(
              'multiGetHistoryByAddress(): explorer fallback failed for',
              scripthash2addr[history.param],
              getErrorMessage(explorerError),
            );
          }
        }
        throw new Error(errorMessage);
      }

      let historyResult = (history.result || []) as ElectrumHistory[];
      const address = scripthash2addr[history.param];
      if (address && historyResult.length >= ELECTRUM_HISTORY_ENTRY_SOFT_LIMIT) {
        try {
          const explorerHistory = await fetchAddressHistoryFromExplorer(address);
          if (explorerHistory.length > historyResult.length) {
            console.warn(
              'multiGetHistoryByAddress(): replacing potentially capped Electrum history with explorer history for',
              address,
              `(${historyResult.length} -> ${explorerHistory.length})`,
            );
            historyResult = explorerHistory;
          }
        } catch (explorerError) {
          console.warn('multiGetHistoryByAddress(): explorer fallback failed for', address, getErrorMessage(explorerError));
        }
      }

      ret[address] = historyResult;
      scripthashHistoryCache[history.param] = historyResult.slice(0);
      for (const result of historyResult) {
        if (result.tx_hash) txhashHeightCache[result.tx_hash] = result.height; // cache tx height
      }

      for (const hist of historyResult) {
        hist.address = address;
      }
    }
  }

  return ret;
};

// if verbose === true ? Record<string, ElectrumTransaction> : Record<string, string>
type MultiGetTransactionByTxidResult<T extends boolean> = T extends true ? Record<string, ElectrumTransaction> : Record<string, string>;

// TODO: this function returns different results based on the value of `verboseParam`, consider splitting it into two
export async function multiGetTransactionByTxid<T extends boolean>(
  txids: string[],
  verbose: T,
  batchsize: number = 45,
): Promise<MultiGetTransactionByTxidResult<T>> {
  txids = txids.filter(txid => !!txid); // failsafe: removing 'undefined' or other falsy stuff from txids array
  // this value is fine-tuned so althrough wallets in test suite will occasionally
  // throw 'response too large (over 1,000,000 bytes', test suite will pass
  if (!mainClient) throw new Error('Electrum client is not connected');
  const ret: MultiGetTransactionByTxidResult<T> = {};
  txids = [...new Set(txids)]; // deduplicate just for any case

  // lets try cache first:
  const realm = await _getRealm();
  const cacheKeySuffix = verbose ? '_verbose' : '_non_verbose';
  const keysCacheMiss = [];
  for (const txid of txids) {
    const jsonString = realm.objectForPrimaryKey('Cache', txid + cacheKeySuffix); // search for a realm object with a primary key
    if (jsonString && jsonString.cache_value) {
      try {
        ret[txid] = JSON.parse(jsonString.cache_value as string);
      } catch (error) {
        console.log(error, 'cache failed to parse', jsonString.cache_value);
      }
    }

    if (!ret[txid]) keysCacheMiss.push(txid);
  }

  if (keysCacheMiss.length === 0) {
    return ret;
  }

  txids = keysCacheMiss;
  // end cache

  const chunks = splitIntoChunks(txids, batchsize);
  for (const chunk of chunks) {
    const chunkBlockHeights = [...new Set(chunk.map(txid => txhashHeightCache[txid]).filter(height => height > 0))];
    await Promise.all(chunkBlockHeights.map(height => getBlockTimestampByHeight(height)));
    let results = [];

    if (disableBatching) {
      try {
        // in case of ElectrumPersonalServer it might not track some transactions (like source transactions for our transactions)
        // so we wrap it in try-catch. note, when `Promise.all` fails we will get _zero_ results, but we have a fallback for that
        const promises = [];
        const index2txid: Record<number, string> = {};
        for (let promiseIndex = 0; promiseIndex < chunk.length; promiseIndex++) {
          const txid = chunk[promiseIndex];
          index2txid[promiseIndex] = txid;
          promises.push(mainClient.blockchainTransaction_get(txid, verbose));
        }

        const transactionResults = await Promise.all(promises);
        for (let resultIndex = 0; resultIndex < transactionResults.length; resultIndex++) {
          let tx = transactionResults[resultIndex];
          const txid = index2txid[resultIndex];
          if (typeof tx === 'string' && verbose) {
            // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
            // lets decode it manually on our end then:
            tx = await decodeTxHexWithChainMetadata(tx, { txidHint: txid });
          }
          results.push({ result: tx, param: txid });
        }
      } catch (error: any) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // electrs-esplora. cant use verbose, so fetching txs one by one and decoding locally
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, false);
              tx = await decodeTxHexWithChainMetadata(tx, { txidHint: txid });
              results.push({ result: tx, param: txid });
            } catch (err) {
              console.log(err);
            }
          }
        } else {
          // fallback. pretty sure we are connected to EPS.  we try getting transactions one-by-one. this way we wont
          // fail and only non-tracked by EPS transactions will be omitted
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, verbose);
              if (typeof tx === 'string' && verbose) {
                // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
                // lets decode it manually on our end then:
                tx = await decodeTxHexWithChainMetadata(tx, { txidHint: txid });
              }
              results.push({ result: tx, param: txid });
            } catch (err) {
              console.log(err);
            }
          }
        }
      }
    } else {
      results = await mainClient.blockchainTransaction_getBatch(chunk, verbose);
    }

    for (const txdata of results) {
      if (txdata.error && txdata.error.code === -32600) {
        // response too large
        // lets do single call, that should go through okay:
        txdata.result = await mainClient.blockchainTransaction_get(txdata.param, false);
        // since we used VERBOSE=false, server sent us plain txhex which we must decode on our end:
        txdata.result = await decodeTxHexWithChainMetadata(txdata.result, { txidHint: txdata.param });
      }
      ret[txdata.param] = txdata.result;
      // @ts-ignore: hex property
      if (ret[txdata.param]) delete ret[txdata.param].hex; // compact
    }
  }

  // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
  for (const txid of Object.keys(ret)) {
    const tx = ret[txid];
    if (typeof tx === 'string') continue;
    for (const vout of tx?.vout ?? []) {
      // @ts-ignore: address is not in type definition
      if (vout?.scriptPubKey?.address) vout.scriptPubKey.addresses = [vout.scriptPubKey.address];
    }
  }

  // saving cache:
  try {
    realm.write(() => {
      for (const txid of Object.keys(ret)) {
        const tx = ret[txid];
        // dont cache immature txs, but only for 'verbose', since its fully decoded tx jsons. non-verbose are just plain
        // strings txhex
        if (verbose && typeof tx !== 'string' && (!tx?.confirmations || tx.confirmations < 7)) {
          continue;
        }

        realm.create(
          'Cache',
          {
            cache_key: txid + cacheKeySuffix,
            cache_value: JSON.stringify(ret[txid]),
          },
          Realm.UpdateMode.Modified,
        );
      }
    });
  } catch (writeError) {
    console.error('Failed to write transaction cache:', writeError);
  }

  return ret;
}

/**
 * Simple waiter till `mainConnected` becomes true (which means
 * it Electrum was connected in other function), or timeout 30 sec.
 */
export const waitTillConnected = async function (): Promise<boolean> {
  let waitTillConnectedInterval: NodeJS.Timeout | undefined;
  let retriesCounter = 0;
  const MAX_WAIT_RETRIES = 300; // 30 seconds
  const RECONNECT_EVERY_N_TICKS = 20; // every 2 seconds
  if (await isDisabled()) {
    console.warn('Electrum connections disabled by user. waitTillConnected skipping...');
    return false;
  }
  return new Promise(function (resolve, reject) {
    if (!mainConnected && !mainClient) {
      connectMain().catch(error => {
        console.warn('waitTillConnected initial connect attempt failed:', error);
      });
    }

    waitTillConnectedInterval = setInterval(() => {
      if (mainConnected) {
        clearInterval(waitTillConnectedInterval);
        return resolve(true);
      }

      if (retriesCounter % RECONNECT_EVERY_N_TICKS === 0 && !mainClient) {
        connectMain().catch(error => {
          console.warn('waitTillConnected reconnect attempt failed:', error);
        });
      }

      if (retriesCounter++ >= MAX_WAIT_RETRIES) {
        clearInterval(waitTillConnectedInterval);
        if (wasConnectedAtLeastOnce) {
          presentNetworkErrorAlert();
        }
        reject(new Error('Waiting for Electrum connection timeout'));
      }
    }, 100);
  });
};

// Returns the value at a given percentile in a sorted numeric array.
// "Linear interpolation between closest ranks" method
function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  if (typeof p !== 'number') throw new TypeError('p must be a number');
  if (p <= 0) return arr[0];
  if (p >= 1) return arr[arr.length - 1];

  const index = (arr.length - 1) * p;
  const lower = Math.floor(index);
  const upper = lower + 1;
  const weight = index % 1;

  if (upper >= arr.length) return arr[lower];
  return arr[lower] * (1 - weight) + arr[upper] * weight;
}

/**
 * The histogram is an array of [fee, vsize] pairs, where vsizen is the cumulative virtual size of mempool transactions
 * with a fee rate in the interval [feen-1, feen], and feen-1 > feen.
 */
export const calcEstimateFeeFromFeeHistorgam = function (numberOfBlocks: number, feeHistorgram: number[][]) {
  // first, transforming histogram:
  let totalVsize = 0;
  const histogramToUse = [];
  for (const h of feeHistorgram) {
    let [fee, vsize] = h;
    let timeToStop = false;

    if (totalVsize + vsize >= 1000000 * numberOfBlocks) {
      vsize = 1000000 * numberOfBlocks - totalVsize; // only the difference between current summarized sige to tip of the block
      timeToStop = true;
    }

    histogramToUse.push({ fee, vsize });
    totalVsize += vsize;
    if (timeToStop) break;
  }

  // now we have histogram of precisely size for numberOfBlocks.
  // lets spread it into flat array so its easier to calculate percentile:
  let histogramFlat: number[] = [];
  for (const hh of histogramToUse) {
    histogramFlat = histogramFlat.concat(Array(Math.round(hh.vsize / 25000)).fill(hh.fee));
    // division is needed so resulting flat array is not too huge
  }

  histogramFlat = histogramFlat.sort(function (a, b) {
    return a - b;
  });

  return Math.round(percentile(histogramFlat, 0.5) || 1);
};

export const estimateFees = async function (): Promise<{ fast: number; medium: number; slow: number }> {
  let histogram;
  let timeoutId;
  try {
    histogram = await Promise.race([
      mainClient.mempool_getFeeHistogram(),
      new Promise(resolve => (timeoutId = setTimeout(resolve, 15000))),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  // fetching what electrum (which uses bitcoin core) thinks about fees:
  const _fast = await estimateFee(1);
  const _medium = await estimateFee(18);
  const _slow = await estimateFee(144);

  /**
   * sanity check, see
   * @see https://github.com/cculianu/Fulcrum/issues/197
   * (fallback to bitcoin core estimates)
   */
  if (!histogram || histogram?.[0]?.[0] > 1000) return { fast: _fast, medium: _medium, slow: _slow };

  // calculating fast fees from mempool:
  const fast = Math.max(2, calcEstimateFeeFromFeeHistorgam(1, histogram));
  // recalculating medium and slow fees using bitcoincore estimations only like relative weights:
  // (minimum 1 sat, just for any case)
  const medium = Math.max(1, Math.round((fast * _medium) / _fast));
  const slow = Math.max(1, Math.round((fast * _slow) / _fast));
  return { fast, medium, slow };
};

/**
 * Returns the estimated transaction fee to be confirmed within a certain number of blocks
 *
 * @param numberOfBlocks {number} The number of blocks to target for confirmation
 * @returns {Promise<number>} Satoshis per byte
 */
export const estimateFee = async function (numberOfBlocks: number): Promise<number> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  numberOfBlocks = numberOfBlocks || 1;
  const coinUnitsPerKilobyte = await mainClient.blockchainEstimatefee(numberOfBlocks);
  if (coinUnitsPerKilobyte === -1) return 1;
  return Math.round(new BigNumber(coinUnitsPerKilobyte).dividedBy(1024).multipliedBy(100000000).toNumber());
};

export const serverFeatures = async function () {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return mainClient.server_features();
};

export const broadcast = async function (hex: string) {
  if (!mainClient) throw new Error('Electrum client is not connected');
  try {
    const res = await mainClient.blockchainTransaction_broadcast(hex);
    return res;
  } catch (error) {
    return error;
  }
};

export const broadcastV2 = async function (hex: string): Promise<string> {
  if (!mainClient) throw new Error('Electrum client is not connected');
  return mainClient.blockchainTransaction_broadcast(hex);
};

export const estimateCurrentBlockheight = function (): number {
  if (latestBlock.height) {
    const timeDiff = Math.floor(+new Date() / 1000) - latestBlock.time;
    const extraBlocks = Math.floor(timeDiff / (9.93 * 60));
    return latestBlock.height + extraBlocks;
  }

  const baseTs = 1587570465609; // uS
  const baseHeight = 627179;
  return Math.floor(baseHeight + (+new Date() - baseTs) / 1000 / 60 / 9.93);
};

export const calculateBlockTime = function (height: number): number {
  if (latestBlock.height) {
    return Math.floor(latestBlock.time + (height - latestBlock.height) * 9.93 * 60);
  }

  const baseTs = 1585837504; // sec
  const baseHeight = 624083;
  return Math.floor(baseTs + (height - baseHeight) * 9.93 * 60);
};

/**
 * @returns {Promise<boolean>} Whether provided host:port is a valid electrum server
 */
export const testConnection = async function (host: string, tcpPort?: number, sslPort?: number): Promise<boolean> {
  const client = new ElectrumClient(net, tls, sslPort || tcpPort, host, sslPort ? 'tls' : 'tcp');

  client.onError = () => {}; // mute
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const rez = await Promise.race([
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), 5000);
      }),
      client.connect(),
    ]);
    if (rez === 'timeout') return false;

    await client.server_version('2.7.11', '1.4');
    await client.server_ping();
    return true;
  } catch (_) {
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    client.close();
  }

  return false;
};

export const forceDisconnect = (): void => {
  mainClient?.close();
};

export const setBatchingDisabled = () => {
  disableBatching = true;
};

export const setBatchingEnabled = () => {
  disableBatching = false;
};

export function getServerBanner(): Promise<string> {
  return mainClient.request('server.banner', []);
}

const splitIntoChunks = function (arr: any[], chunkSize: number) {
  const groups = [];
  let i;
  for (i = 0; i < arr.length; i += chunkSize) {
    groups.push(arr.slice(i, i + chunkSize));
  }
  return groups;
};

const semVerToInt = function (semver: string): number {
  if (!semver) return 0;
  if (semver.split('.').length !== 3) return 0;

  const ret = Number(semver.split('.')[0]) * 1000000 + Number(semver.split('.')[1]) * 1000 + Number(semver.split('.')[2]) * 1;

  if (isNaN(ret)) return 0;

  return ret;
};
