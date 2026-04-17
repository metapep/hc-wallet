import { BitcoinUnit, Chain } from '../models/bitcoinUnits';
import { LightningTransaction, Transaction, TWallet } from './wallets/types';

export type SyncScope = 'home' | 'wallet' | 'all';
export type SyncPriority = 'high' | 'normal' | 'low';

export type SyncRequest = {
  scope: SyncScope;
  walletIds?: string[];
  reason: string;
  priority: SyncPriority;
};

export type WalletPageCursor = {
  walletId: string;
  revision: string;
  offset: number;
};

export type TxHydrationLevel = 'history' | 'body' | 'enriched';

export type TransactionDirection = 'incoming' | 'outgoing' | 'pending' | 'self';

export type TransactionRowVM = (Transaction & Partial<LightningTransaction>) & {
  walletID: string;
  walletIds: string[];
  walletPreferredBalanceUnit: BitcoinUnit;
  displayValue: number;
  fee?: number;
  direction: TransactionDirection;
  hydrationLevel: TxHydrationLevel;
  isPendingDetails: boolean;
};

export type WalletPageResult = {
  revision: string;
  rows: TransactionRowVM[];
  nextCursor?: WalletPageCursor;
  hasMore: boolean;
};

type HomeFeedListener = (rows: TransactionRowVM[]) => void;
type WalletFeedListener = (walletId: string, revision: string, rows: TransactionRowVM[]) => void;

type PersistedWalletSnapshot = {
  revision: string;
  rows: TransactionRowVM[];
};

type PersistedSnapshot = {
  version: 1;
  updatedAt: number;
  wallets: Record<string, PersistedWalletSnapshot>;
};

type WalletRowsByRevision = {
  currentRevision: string;
  revisions: Map<string, TransactionRowVM[]>;
};

type PendingBatch = {
  scope: SyncScope;
  priority: SyncPriority;
  reasons: Set<string>;
  walletIds: Set<string>;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
};

const SNAPSHOT_STORAGE_KEY = 'tx_sync_wallet_head_snapshot_v1';
const MAX_REVISIONS_PER_WALLET = 3;
const HOME_FEED_ROWS_PER_WALLET = 10;
const PERSISTED_HEAD_ROWS_PER_WALLET = 20;
const TX_BODY_CACHE_LIMIT = 500;
const PREVOUT_CACHE_LIMIT = 2000;

const priorityDelay: Record<SyncPriority, number> = {
  high: 40,
  normal: 120,
  low: 260,
};

export type TransactionSyncCoordinatorDependencies = {
  getWallets: () => TWallet[];
  performSync: (request: SyncRequest) => Promise<void>;
  loadSnapshot: (storageKey: string) => Promise<string | null | undefined>;
  saveSnapshot: (storageKey: string, serialized: string) => Promise<void>;
};

const rankPriority = (priority: SyncPriority): number => {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
};

const choosePriority = (a: SyncPriority, b: SyncPriority): SyncPriority => {
  return rankPriority(a) >= rankPriority(b) ? a : b;
};

const compareRows = (a: TransactionRowVM, b: TransactionRowVM): number => {
  if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
  const confirmationA = a.confirmations ?? 0;
  const confirmationB = b.confirmations ?? 0;
  if (confirmationB !== confirmationA) return confirmationB - confirmationA;
  return b.txid.localeCompare(a.txid);
};

const setWithLimit = <T>(map: Map<string, T>, key: string, value: T, maxEntries: number): void => {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size <= maxEntries) return;
  const oldestKey = map.keys().next().value;
  if (oldestKey) map.delete(oldestKey);
};

export class TransactionSyncCoordinator {
  private readonly deps: TransactionSyncCoordinatorDependencies;

  // Memory caches described in the implementation plan.
  readonly scripthashStatusCache = new Map<string, string | undefined>();
  readonly addressHistoryCache = new Map<string, { tx_hash: string; height: number }[]>();
  readonly walletTxIndexCache = new Map<string, { revision: string; orderedTxids: string[] }>();
  readonly txBodyLRU = new Map<string, Transaction>();
  readonly prevoutLRU = new Map<string, { value: number; address?: string; sourceTxid: string }>();
  readonly inFlightRequestMap = new Map<string, Promise<void>>();

  private readonly walletRowsByRevision = new Map<string, WalletRowsByRevision>();
  private readonly homeFeedListeners = new Set<HomeFeedListener>();
  private readonly walletFeedListenersByWalletId = new Map<string, Set<WalletFeedListener>>();

  private homeFeed: TransactionRowVM[] = [];
  private pendingBatch: PendingBatch | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private processingQueue = Promise.resolve();

  constructor(dependencies: TransactionSyncCoordinatorDependencies) {
    this.deps = dependencies;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const raw = await this.deps.loadSnapshot(SNAPSHOT_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedSnapshot;
        if (!parsed || parsed.version !== 1 || !parsed.wallets || typeof parsed.wallets !== 'object') return;

        for (const [walletId, snapshot] of Object.entries(parsed.wallets)) {
          if (!snapshot || !snapshot.revision || !Array.isArray(snapshot.rows)) continue;
          const revisions = new Map<string, TransactionRowVM[]>();
          revisions.set(snapshot.revision, snapshot.rows);
          this.walletRowsByRevision.set(walletId, {
            currentRevision: snapshot.revision,
            revisions,
          });
          this.walletTxIndexCache.set(walletId, {
            revision: snapshot.revision,
            orderedTxids: snapshot.rows.map(row => row.txid),
          });
        }

        this.recomputeHomeFeed();
      } catch (error) {
        console.warn('[TransactionSyncCoordinator] Failed to initialize persisted snapshots', error);
      } finally {
        this.initialized = true;
      }
    })();

    return this.initPromise;
  }

  dispose(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.homeFeedListeners.clear();
    this.walletFeedListenersByWalletId.clear();
  }

  hydrateFromWallets(wallets: TWallet[] = this.deps.getWallets()): void {
    const knownWalletIds = new Set<string>();

    for (const wallet of wallets) {
      if (!wallet || wallet.chain !== Chain.ONCHAIN) continue;
      const walletId = wallet.getID();
      knownWalletIds.add(walletId);
      const rows = this.buildRowsForWallet(wallet);
      const revision = this.computeRevision(rows);
      this.upsertWalletRevision(walletId, revision, rows);
      this.walletTxIndexCache.set(walletId, {
        revision,
        orderedTxids: rows.map(row => row.txid),
      });
      this.notifyWalletFeed(walletId, revision, rows);
    }

    for (const walletId of [...this.walletRowsByRevision.keys()]) {
      if (knownWalletIds.has(walletId)) continue;
      this.walletRowsByRevision.delete(walletId);
      this.walletTxIndexCache.delete(walletId);
    }

    this.recomputeHomeFeed();
    this.persistHeadSnapshot().catch(error => {
      console.warn('[TransactionSyncCoordinator] Failed to persist head snapshot', error);
    });
  }

  requestSync(request: SyncRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      this.initialize()
        .then(() => {
          const normalized = this.normalizeRequest(request);
          this.mergePendingBatch(normalized, resolve, reject);
          this.schedulePendingFlush(normalized.priority);
        })
        .catch(reject);
    });
  }

  getHomeFeed(): TransactionRowVM[] {
    return this.homeFeed.slice();
  }

  getWalletPage(walletId: string, cursor?: WalletPageCursor, pageSize: number = 25): WalletPageResult {
    const safePageSize = Math.max(1, pageSize);
    const state = this.walletRowsByRevision.get(walletId);
    if (!state) {
      return {
        revision: '',
        rows: [],
        hasMore: false,
      };
    }

    const requestedRevision = cursor?.revision;
    const activeRevision = requestedRevision && state.revisions.has(requestedRevision) ? requestedRevision : state.currentRevision;
    const rows = state.revisions.get(activeRevision) ?? [];
    const offset = cursor?.offset ?? 0;
    const nextOffset = offset + safePageSize;
    const pageRows = rows.slice(offset, nextOffset);
    const hasMore = nextOffset < rows.length;
    const nextCursor = hasMore
      ? {
          walletId,
          revision: activeRevision,
          offset: nextOffset,
        }
      : undefined;

    return {
      revision: activeRevision,
      rows: pageRows,
      nextCursor,
      hasMore,
    };
  }

  prefetchNextWalletPage(walletId: string, cursor?: WalletPageCursor, pageSize: number = 25): void {
    if (!cursor) return;
    const nextPage = this.getWalletPage(walletId, cursor, pageSize);
    for (const row of nextPage.rows) {
      if (row.hydrationLevel === 'history') continue;
      if (typeof row.txid !== 'string' || row.txid.length === 0) continue;
      setWithLimit(this.txBodyLRU, row.txid, row, TX_BODY_CACHE_LIMIT);
    }
  }

  subscribeHomeFeed(listener: HomeFeedListener): () => void {
    this.homeFeedListeners.add(listener);
    listener(this.getHomeFeed());
    return () => {
      this.homeFeedListeners.delete(listener);
    };
  }

  subscribeWalletFeed(walletId: string, listener: WalletFeedListener): () => void {
    const listeners = this.walletFeedListenersByWalletId.get(walletId) ?? new Set<WalletFeedListener>();
    listeners.add(listener);
    this.walletFeedListenersByWalletId.set(walletId, listeners);
    const state = this.walletRowsByRevision.get(walletId);
    if (state) {
      const rows = state.revisions.get(state.currentRevision) ?? [];
      listener(walletId, state.currentRevision, rows.slice());
    }

    return () => {
      const walletListeners = this.walletFeedListenersByWalletId.get(walletId);
      if (!walletListeners) return;
      walletListeners.delete(listener);
      if (walletListeners.size === 0) {
        this.walletFeedListenersByWalletId.delete(walletId);
      }
    };
  }

  private normalizeRequest(request: SyncRequest): SyncRequest {
    const allOnchainWalletIds = this.deps
      .getWallets()
      .filter(wallet => wallet.chain === Chain.ONCHAIN)
      .map(wallet => wallet.getID());

    if (request.scope === 'all' || request.scope === 'home') {
      return {
        ...request,
        walletIds: allOnchainWalletIds,
      };
    }

    const walletIds = new Set<string>(request.walletIds ?? []);
    const filtered = allOnchainWalletIds.filter(walletId => walletIds.has(walletId));

    return {
      ...request,
      walletIds: filtered.length > 0 ? filtered : allOnchainWalletIds,
    };
  }

  private mergePendingBatch(request: SyncRequest, resolve: () => void, reject: (error: unknown) => void): void {
    if (!this.pendingBatch) {
      this.pendingBatch = {
        scope: request.scope,
        priority: request.priority,
        reasons: new Set([request.reason]),
        walletIds: new Set(request.walletIds ?? []),
        resolvers: [resolve],
        rejecters: [reject],
      };
      return;
    }

    this.pendingBatch.scope = this.mergeScope(this.pendingBatch.scope, request.scope);
    this.pendingBatch.priority = choosePriority(this.pendingBatch.priority, request.priority);
    this.pendingBatch.reasons.add(request.reason);
    for (const walletId of request.walletIds ?? []) {
      this.pendingBatch.walletIds.add(walletId);
    }
    this.pendingBatch.resolvers.push(resolve);
    this.pendingBatch.rejecters.push(reject);
  }

  private mergeScope(a: SyncScope, b: SyncScope): SyncScope {
    if (a === 'all' || b === 'all') return 'all';
    if (a === 'wallet' || b === 'wallet') return 'wallet';
    return 'home';
  }

  private schedulePendingFlush(priority: SyncPriority): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.flushPendingBatch().catch(error => {
        console.warn('[TransactionSyncCoordinator] flushPendingBatch failed', error);
      });
    }, priorityDelay[priority]);
  }

  private async flushPendingBatch(): Promise<void> {
    const batch = this.pendingBatch;
    this.pendingBatch = null;
    if (!batch) return;

    const request: SyncRequest = {
      scope: batch.scope,
      walletIds: [...batch.walletIds],
      priority: batch.priority,
      reason: [...batch.reasons].join(','),
    };

    this.processingQueue = this.processingQueue
      .then(async () => {
        try {
          await this.executeSyncRequest(request);
          batch.resolvers.forEach(resolver => resolver());
        } catch (error) {
          batch.rejecters.forEach(rejecter => rejecter(error));
        }
      })
      .catch(error => {
        console.warn('[TransactionSyncCoordinator] processing queue failed', error);
      });

    await this.processingQueue;
  }

  private async executeSyncRequest(request: SyncRequest): Promise<void> {
    const sortedWalletIds = (request.walletIds ?? []).slice().sort();
    const dedupeKey = `${request.scope}|${request.priority}|${sortedWalletIds.join(',')}`;
    const inFlight = this.inFlightRequestMap.get(dedupeKey);
    if (inFlight) {
      await inFlight;
      return;
    }

    const runner = (async () => {
      await this.deps.performSync(request);
      this.hydrateFromWallets();
    })();

    this.inFlightRequestMap.set(dedupeKey, runner);

    try {
      await runner;
    } finally {
      this.inFlightRequestMap.delete(dedupeKey);
    }
  }

  private buildRowsForWallet(wallet: TWallet): TransactionRowVM[] {
    const walletId = wallet.getID();
    const preferredUnit = wallet.getPreferredBalanceUnit ? wallet.getPreferredBalanceUnit() : BitcoinUnit.BTC;
    const txs = wallet
      .getTransactions()
      .slice()
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    const rows: TransactionRowVM[] = [];

    for (const tx of txs) {
      const txid = tx.txid || tx.hash;
      if (!txid) continue;
      const hash = tx.hash || txid;
      const hasInputsOrOutputs = Array.isArray(tx.inputs) || Array.isArray(tx.outputs);
      const missingInputDetails = (tx.inputs ?? []).some(input => input.txid && typeof input.value !== 'number');
      const hydrationLevel: TxHydrationLevel = !hasInputsOrOutputs ? 'history' : missingInputDetails ? 'body' : 'enriched';
      const direction: TransactionDirection =
        !tx.confirmations || tx.confirmations <= 0
          ? 'pending'
          : (tx.value ?? 0) > 0
            ? 'incoming'
            : (tx.value ?? 0) < 0
              ? 'outgoing'
              : 'self';

      const fee = this.calculateFeeSats(tx);
      const row: TransactionRowVM = {
        ...tx,
        txid,
        hash,
        walletID: walletId,
        walletIds: [walletId],
        walletPreferredBalanceUnit: preferredUnit,
        displayValue: Number(tx.value ?? 0),
        fee,
        direction,
        hydrationLevel,
        isPendingDetails: hydrationLevel !== 'enriched',
        timestamp: tx.timestamp || tx.blocktime || tx.time || Math.floor(Date.now() / 1000),
      };
      rows.push(row);

      setWithLimit(this.txBodyLRU, txid, tx, TX_BODY_CACHE_LIMIT);
      if (!row.inputs) continue;
      for (const input of row.inputs) {
        if (!input.txid || typeof input.vout !== 'number' || typeof input.value !== 'number') continue;
        const outpoint = `${input.txid}:${input.vout}`;
        setWithLimit(
          this.prevoutLRU,
          outpoint,
          {
            value: input.value,
            address: input.addresses?.[0],
            sourceTxid: input.txid,
          },
          PREVOUT_CACHE_LIMIT,
        );
      }
    }

    rows.sort(compareRows);
    return rows;
  }

  private calculateFeeSats(tx: Transaction): number | undefined {
    if (!Array.isArray(tx.inputs) || tx.inputs.length === 0) return undefined;
    if (!Array.isArray(tx.outputs) || tx.outputs.length === 0) return undefined;
    if (tx.inputs.some(input => input.txid && typeof input.value !== 'number')) return undefined;

    const inputSats = tx.inputs.reduce((sum, input) => {
      const value = typeof input.value === 'number' ? input.value : 0;
      return sum + Math.round(value * 100000000);
    }, 0);

    const outputSats = tx.outputs.reduce((sum, output) => {
      const value = typeof output.value === 'number' ? output.value : 0;
      return sum + Math.round(value * 100000000);
    }, 0);

    return Math.max(0, inputSats - outputSats);
  }

  private computeRevision(rows: TransactionRowVM[]): string {
    const count = rows.length;
    const first = rows[0]?.txid ?? 'none';
    const last = rows[count - 1]?.txid ?? 'none';

    let checksum = 17;
    for (const row of rows) {
      const txidPrefix = row.txid.slice(0, 8);
      for (let i = 0; i < txidPrefix.length; i++) {
        checksum = (checksum * 31 + txidPrefix.charCodeAt(i)) % 2147483647;
      }
      checksum = (checksum * 31 + row.timestamp) % 2147483647;
      checksum = (checksum * 31 + (row.confirmations ?? 0)) % 2147483647;
    }

    return `${count}:${first}:${last}:${checksum}`;
  }

  private upsertWalletRevision(walletId: string, revision: string, rows: TransactionRowVM[]): void {
    const existing = this.walletRowsByRevision.get(walletId);

    if (!existing) {
      const revisions = new Map<string, TransactionRowVM[]>();
      revisions.set(revision, rows);
      this.walletRowsByRevision.set(walletId, {
        currentRevision: revision,
        revisions,
      });
      return;
    }

    existing.revisions.set(revision, rows);
    existing.currentRevision = revision;

    while (existing.revisions.size > MAX_REVISIONS_PER_WALLET) {
      const oldestRevision = existing.revisions.keys().next().value;
      if (!oldestRevision) break;
      if (oldestRevision === revision && existing.revisions.size === 1) break;
      existing.revisions.delete(oldestRevision);
    }
  }

  private recomputeHomeFeed(): void {
    const merged: TransactionRowVM[] = [];

    for (const [walletId, state] of this.walletRowsByRevision.entries()) {
      const rows = state.revisions.get(state.currentRevision) ?? [];
      const topRows = rows.slice(0, HOME_FEED_ROWS_PER_WALLET);
      for (const row of topRows) {
        merged.push({ ...row, walletID: walletId, walletIds: [walletId] });
      }
    }

    merged.sort(compareRows);
    this.homeFeed = merged;
    this.notifyHomeFeed();
  }

  private notifyHomeFeed(): void {
    const snapshot = this.getHomeFeed();
    for (const listener of this.homeFeedListeners) {
      listener(snapshot);
    }
  }

  private notifyWalletFeed(walletId: string, revision: string, rows: TransactionRowVM[]): void {
    const listeners = this.walletFeedListenersByWalletId.get(walletId);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(walletId, revision, rows.slice());
    }
  }

  private async persistHeadSnapshot(): Promise<void> {
    const wallets: Record<string, PersistedWalletSnapshot> = {};

    for (const [walletId, state] of this.walletRowsByRevision.entries()) {
      const rows = state.revisions.get(state.currentRevision) ?? [];
      wallets[walletId] = {
        revision: state.currentRevision,
        rows: rows.slice(0, PERSISTED_HEAD_ROWS_PER_WALLET),
      };
    }

    const payload: PersistedSnapshot = {
      version: 1,
      updatedAt: Date.now(),
      wallets,
    };

    await this.deps.saveSnapshot(SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
  }
}
