import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutAnimation } from 'react-native';
import { BlueApp as BlueAppClass, LegacyWallet, TCounterpartyMetadata, TTXMetadata, WatchOnlyWallet } from '../../class';
import type { TWallet } from '../../class/wallets/types';
import presentAlert from '../../components/Alert';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { startAndDecrypt } from '../../blue_modules/start-and-decrypt';
import { isNotificationsEnabled, majorTomToGroundControl, unsubscribe } from '../../blue_modules/notifications';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { navigationRef } from '../../NavigationService';
import { getScanWasBBQR } from '../../helpers/scan-qr.ts';
import { setWalletIdMustUseBBQR } from '../../blue_modules/ur';
import {
  SyncRequest,
  TransactionRowVM,
  TransactionSyncCoordinator,
  WalletPageCursor,
  WalletPageResult,
} from '../../class/transaction-sync-coordinator';

const BlueApp = BlueAppClass.getInstance();

// hashmap of timestamps we _started_ refetching some wallet
const _lastTimeTriedToRefetchWallet: { [walletID: string]: number } = {};
const REFRESH_CONNECT_TIMEOUT_MS = 12000;
const REFRESH_BALANCE_TIMEOUT_MS = 15000;
const REFRESH_TX_TIMEOUT_MS = 20000;
const REFRESH_TX_BACKFILL_TIMEOUT_MS = 180000;
const REFRESH_RETRY_DELAY_MS = 5000;

class RefreshTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'RefreshTimeoutError';
  }
}

const isRefreshTimeoutError = (error: unknown): error is RefreshTimeoutError =>
  error instanceof RefreshTimeoutError || (error as Error)?.name === 'RefreshTimeoutError';

interface StorageContextType {
  wallets: TWallet[];
  setWalletsWithNewOrder: (wallets: TWallet[]) => void;
  txMetadata: TTXMetadata;
  counterpartyMetadata: TCounterpartyMetadata;
  saveToDisk: (force?: boolean) => Promise<void>;
  selectedWalletID: () => string | undefined; // Change from string|undefined to a function
  addWallet: (wallet: TWallet) => void;
  deleteWallet: (wallet: TWallet) => void;
  currentSharedCosigner: string;
  setSharedCosigner: (cosigner: string) => void;
  addAndSaveWallet: (wallet: TWallet) => Promise<void>;
  fetchAndSaveWalletTransactions: (walletID: string) => Promise<void>;
  walletsInitialized: boolean;
  setWalletsInitialized: (initialized: boolean) => void;
  refreshAllWalletTransactions: (lastSnappedTo?: number, showUpdateStatusIndicator?: boolean) => Promise<void>;
  requestTransactionSync: (request: SyncRequest) => Promise<void>;
  getHomeFeed: () => TransactionRowVM[];
  getWalletPage: (walletId: string, cursor?: WalletPageCursor, pageSize?: number) => WalletPageResult;
  subscribeHomeFeed: (listener: (rows: TransactionRowVM[]) => void) => () => void;
  subscribeWalletFeed: (walletId: string, listener: (walletId: string, revision: string, rows: TransactionRowVM[]) => void) => () => void;
  prefetchNextWalletPage: (walletId: string, cursor?: WalletPageCursor, pageSize?: number) => void;
  resetWallets: () => void;
  walletTransactionUpdateStatus: WalletTransactionsStatus | string;
  setWalletTransactionUpdateStatus: (status: WalletTransactionsStatus | string) => void;
  getTransactions: typeof BlueApp.getTransactions;
  fetchWalletBalances: typeof BlueApp.fetchWalletBalances;
  fetchWalletTransactions: typeof BlueApp.fetchWalletTransactions;
  getBalance: typeof BlueApp.getBalance;
  isStorageEncrypted: typeof BlueApp.storageIsEncrypted;
  startAndDecrypt: typeof startAndDecrypt;
  encryptStorage: typeof BlueApp.encryptStorage;
  sleep: typeof BlueApp.sleep;
  createFakeStorage: typeof BlueApp.createFakeStorage;
  decryptStorage: typeof BlueApp.decryptStorage;
  isPasswordInUse: typeof BlueApp.isPasswordInUse;
  cachedPassword: typeof BlueApp.cachedPassword;
  getItem: typeof BlueApp.getItem;
  setItem: typeof BlueApp.setItem;
  handleWalletDeletion: (walletID: string, forceDelete?: boolean) => Promise<boolean>;
  confirmWalletDeletion: (wallet: any, onConfirmed: () => void) => void;
}

export enum WalletTransactionsStatus {
  NONE = 'NONE',
  ALL = 'ALL',
}

// @ts-ignore default value does not match the type
export const StorageContext = createContext<StorageContextType>(undefined);

export const StorageProvider = ({ children }: { children: React.ReactNode }) => {
  const txMetadata = useRef<TTXMetadata>(BlueApp.tx_metadata);
  const counterpartyMetadata = useRef<TCounterpartyMetadata>(BlueApp.counterparty_metadata || {}); // init

  const [wallets, setWallets] = useState<TWallet[]>([]);
  const [walletTransactionUpdateStatus, setWalletTransactionUpdateStatus] = useState<WalletTransactionsStatus | string>(
    WalletTransactionsStatus.NONE,
  );
  const [walletsInitialized, setWalletsInitialized] = useState<boolean>(false);
  const [currentSharedCosigner, setCurrentSharedCosigner] = useState<string>('');

  const selectedWalletID = useCallback((): string | undefined => {
    if (!navigationRef.current || !navigationRef.current.isReady()) return undefined;

    const screensToCheck = ['LNDCreateInvoice', 'SendDetails', 'WalletTransactions', 'TransactionStatus'];

    const currentRoute = navigationRef.current.getCurrentRoute();
    console.debug('[StorageProvider] Current route:', currentRoute?.name);

    if (currentRoute) {
      if (screensToCheck.includes(currentRoute.name) && currentRoute.params) {
        const params = currentRoute.params as { walletID?: string };
        if (params.walletID) {
          console.debug('[StorageProvider] selectedWalletID from current route:', params.walletID);
          return params.walletID;
        }
      }
    }

    const state = navigationRef.current.getState();

    if (state?.routes) {
      for (const screenName of screensToCheck) {
        const walletID = findWalletIDInNavigationState(state.routes, screenName);
        if (walletID) {
          console.debug('[StorageProvider] selectedWalletID from navigation state:', walletID, 'in screen:', screenName);
          return walletID;
        }
      }

      const drawerRoute = state.routes.find(route => route.name === 'DrawerRoot');
      if (drawerRoute?.state?.routes) {
        const detailViewStack = drawerRoute.state.routes.find(route => route.name === 'DetailViewStackScreensStack');
        if (detailViewStack?.state?.routes) {
          for (const route of detailViewStack.state.routes) {
            if (screensToCheck.includes(route.name) && (route.params as { walletID?: string })?.walletID) {
              console.debug(
                '[StorageProvider] selectedWalletID from drawer navigation:',
                (route.params as { walletID?: string })?.walletID,
              );
              return (route.params as { walletID?: string })?.walletID;
            }
          }
        }
      }
    }

    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findWalletIDInNavigationState = (routes: any[], screenName: string): string | undefined => {
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i];

      if (route.name === screenName && (route.params as { walletID?: string }).walletID) {
        return (route.params as { walletID?: string }).walletID;
      }

      if (route.state?.routes) {
        const walletID = findWalletIDInNavigationState(route.state.routes, screenName);
        if (walletID) return walletID;
      }

      if (route.params?.screen === screenName && route.params?.params?.walletID) {
        return route.params.params.walletID;
      }

      if (route.name === 'DetailViewStackScreensStack' && route.params?.screen === screenName && route.params?.params?.walletID) {
        return route.params.params.walletID;
      }
    }

    return undefined;
  };

  const saveToDisk = useCallback(
    async (force: boolean = false) => {
      if (!force && BlueApp.getWallets().length === 0) {
        console.debug('Not saving empty wallets array');
        return;
      }
      BlueApp.tx_metadata = txMetadata.current;
      BlueApp.counterparty_metadata = counterpartyMetadata.current;
      await BlueApp.saveToDisk();
      const w: TWallet[] = [...BlueApp.getWallets()];
      setWallets(w);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txMetadata.current, counterpartyMetadata.current],
  );

  const addWallet = useCallback((wallet: TWallet) => {
    BlueApp.wallets.push(wallet);
    setWallets([...BlueApp.getWallets()]);
  }, []);

  const deleteWallet = useCallback((wallet: TWallet) => {
    BlueApp.deleteWallet(wallet);
    setWallets([...BlueApp.getWallets()]);
  }, []);

  const handleWalletDeletion = useCallback(
    async (walletID: string, forceDelete = false): Promise<boolean> => {
      console.debug(`handleWalletDeletion: invoked for walletID ${walletID}`);
      const wallet = wallets.find(w => w.getID() === walletID);
      if (!wallet) {
        console.warn(`handleWalletDeletion: wallet not found for ${walletID}`);
        return false;
      }

      if (forceDelete) {
        deleteWallet(wallet);
        await saveToDisk(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        return true;
      }

      let isNotificationsSettingsEnabled = false;
      try {
        isNotificationsSettingsEnabled = await isNotificationsEnabled();
      } catch (error) {
        console.error(`handleWalletDeletion: error checking notifications for wallet ${walletID}`, error);
        return await new Promise<boolean>(resolve => {
          presentAlert({
            title: loc.errors.error,
            message: loc.wallets.details_delete_wallet_error_message,
            buttons: [
              {
                text: loc.wallets.details_delete_anyway,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID, true);
                  resolve(result);
                },
                style: 'destructive',
              },
              {
                text: loc.wallets.list_tryagain,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID);
                  resolve(result);
                },
              },
              {
                text: loc._.cancel,
                onPress: () => resolve(false),
                style: 'cancel',
              },
            ],
            options: { cancelable: false },
          });
        });
      }

      try {
        if (isNotificationsSettingsEnabled) {
          const externalAddresses = wallet.getAllExternalAddresses();
          if (externalAddresses.length > 0) {
            console.debug(`handleWalletDeletion: unsubscribing addresses for wallet ${walletID}`);
            try {
              await unsubscribe(externalAddresses, [], []);
              console.debug(`handleWalletDeletion: unsubscribe succeeded for wallet ${walletID}`);
            } catch (unsubscribeError) {
              console.error(`handleWalletDeletion: unsubscribe failed for wallet ${walletID}`, unsubscribeError);
              presentAlert({
                title: loc.errors.error,
                message: loc.wallets.details_delete_wallet_error_message,
                buttons: [{ text: loc._.ok, onPress: () => {} }],
                options: { cancelable: false },
              });
              return false;
            }
          }
        }
        deleteWallet(wallet);
        console.debug(`handleWalletDeletion: wallet ${walletID} deleted successfully`);
        await saveToDisk(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        return true;
      } catch (e: unknown) {
        console.error(`handleWalletDeletion: encountered error for wallet ${walletID}`, e);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return await new Promise<boolean>(resolve => {
          presentAlert({
            title: loc.errors.error,
            message: loc.wallets.details_delete_wallet_error_message,
            buttons: [
              {
                text: loc.wallets.details_delete_anyway,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID, true);
                  resolve(result);
                },
                style: 'destructive',
              },
              {
                text: loc.wallets.list_tryagain,
                onPress: async () => {
                  const result = await handleWalletDeletion(walletID);
                  resolve(result);
                },
              },
              {
                text: loc._.cancel,
                onPress: () => resolve(false),
                style: 'cancel',
              },
            ],
            options: { cancelable: false },
          });
        });
      }
    },
    [deleteWallet, saveToDisk, wallets],
  );

  const resetWallets = useCallback(() => {
    setWallets(BlueApp.getWallets());
  }, []);

  const setWalletsWithNewOrder = useCallback(
    (wlts: TWallet[]) => {
      BlueApp.wallets = wlts;
      saveToDisk();
    },
    [saveToDisk],
  );

  // Initialize wallets
  useEffect(() => {
    if (walletsInitialized) {
      txMetadata.current = BlueApp.tx_metadata;
      counterpartyMetadata.current = BlueApp.counterparty_metadata;
      setWallets(BlueApp.getWallets());
    }
  }, [walletsInitialized]);

  type RefreshRequest = {
    walletIndexes: number[];
    explorerFallbackWalletIndexes: number[];
    useExtendedTxTimeout: boolean;
    showUpdateStatusIndicator: boolean;
    allowRetry: boolean;
  };

  const refreshingRef = useRef<boolean>(false);
  const pendingRefreshRequestRef = useRef<RefreshRequest | null>(null);
  const refreshQueueDrainResolversRef = useRef<Array<() => void>>([]);
  const refreshRunIdRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const withTimeout = useCallback(async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => reject(new RefreshTimeoutError(label, timeoutMs)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }, []);

  const mergeRefreshRequests = useCallback((existing: RefreshRequest | null, incoming: RefreshRequest): RefreshRequest => {
    if (!existing) return incoming;
    const walletIndexes = [...new Set([...existing.walletIndexes, ...incoming.walletIndexes])].sort((a, b) => a - b);
    const explorerFallbackWalletIndexes = [
      ...new Set([...existing.explorerFallbackWalletIndexes, ...incoming.explorerFallbackWalletIndexes]),
    ].sort((a, b) => a - b);
    return {
      walletIndexes,
      explorerFallbackWalletIndexes,
      useExtendedTxTimeout: existing.useExtendedTxTimeout || incoming.useExtendedTxTimeout,
      showUpdateStatusIndicator: existing.showUpdateStatusIndicator || incoming.showUpdateStatusIndicator,
      allowRetry: existing.allowRetry || incoming.allowRetry,
    };
  }, []);

  const connectAndPingElectrum = useCallback(
    async (runId: number, ignoreSavedPeer: boolean = false): Promise<void> => {
      if (runId !== refreshRunIdRef.current) return;
      await withTimeout('connect/ping', REFRESH_CONNECT_TIMEOUT_MS, async () => {
        await BlueElectrum.connectMain({ ignoreSavedPeer, showErrorAlert: false });
        await BlueElectrum.waitTillConnected();
        if (!(await BlueElectrum.ping())) {
          console.warn('[refreshAllWalletTransactions] ping failed, reconnecting...');
          await BlueElectrum.connectMain({ ignoreSavedPeer, showErrorAlert: false });
          await BlueElectrum.waitTillConnected();
          if (!(await BlueElectrum.ping())) {
            throw new Error('Electrum ping failed after reconnect');
          }
        }
      });
    },
    [withTimeout],
  );

  const refreshWalletByIndex = useCallback(
    async (
      walletIndex: number,
      runId: number,
      useExplorerHistoryFallback: boolean = false,
      useExtendedTxTimeout: boolean = false,
    ): Promise<{ hasSuccessfulUpdate: boolean; hasFailure: boolean; shouldRetry: boolean }> => {
      const wallet = BlueApp.getWallets()[walletIndex];
      const walletLabel = wallet ? `${wallet.getLabel()} (${wallet.getID()})` : `#${walletIndex}`;
      let hasSuccessfulUpdate = false;
      let hasFailure = false;
      let shouldRetry = true;

      const runStage = async (
        stage: 'balance' | 'transactions',
        timeoutMs: number,
        runner: () => Promise<void>,
        options: { requireElectrumConnection?: boolean } = {},
      ) => {
        const { requireElectrumConnection = true } = options;
        if (runId !== refreshRunIdRef.current) return;

        if (requireElectrumConnection) {
          try {
            await connectAndPingElectrum(runId);
          } catch (error) {
            hasFailure = true;
            if (isRefreshTimeoutError(error)) {
              console.warn(`[refreshAllWalletTransactions] connect timed out for wallet ${walletLabel}`, error);
              BlueElectrum.forceDisconnect();
            } else {
              console.warn(`[refreshAllWalletTransactions] connect failed for wallet ${walletLabel}`, error);
            }
            return;
          }
        }

        if (runId !== refreshRunIdRef.current) return;

        try {
          await withTimeout(`${stage}:${walletLabel}`, timeoutMs, runner);
          hasSuccessfulUpdate = true;
          if (runId === refreshRunIdRef.current) {
            setWallets([...BlueApp.getWallets()]);
          }
        } catch (error) {
          hasFailure = true;
          if (isRefreshTimeoutError(error)) {
            console.warn(`[refreshAllWalletTransactions] ${stage} timed out for wallet ${walletLabel}`, error);
            BlueElectrum.forceDisconnect();
            if (stage === 'transactions') {
              // Transactions stage timeout can keep long explorer pagination alive in background.
              // Skip immediate retry to avoid doubling network load.
              shouldRetry = false;
            }
          } else {
            console.warn(`[refreshAllWalletTransactions] ${stage} failed for wallet ${walletLabel}`, error);
          }
        }
      };

      await runStage('balance', REFRESH_BALANCE_TIMEOUT_MS, async () => {
        await BlueApp.fetchWalletBalances(walletIndex);
      });
      const txStageTimeoutMs = useExtendedTxTimeout ? REFRESH_TX_BACKFILL_TIMEOUT_MS : REFRESH_TX_TIMEOUT_MS;
      await runStage(
        'transactions',
        txStageTimeoutMs,
        async () => {
          if (useExplorerHistoryFallback) {
            await BlueElectrum.withExplorerHistoryFallback(async () => {
              await BlueApp.fetchWalletTransactions(walletIndex);
            });
            return;
          }
          await BlueApp.fetchWalletTransactions(walletIndex);
        },
        { requireElectrumConnection: !BlueElectrum.isExplorerHistorySourceEnabled() },
      );

      const walletAfterTx = BlueApp.getWallets()[walletIndex];
      if (!hasFailure && walletAfterTx?.isHistoryBackfillRequired()) {
        // The server capped history for this wallet. Keep current cached rows and avoid retry loops.
        shouldRetry = false;
        console.warn(
          `[refreshAllWalletTransactions] history limited by server for wallet ${walletLabel}; keeping cached transactions without alternate-peer retry`,
        );
      }

      return { hasSuccessfulUpdate, hasFailure, shouldRetry };
    },
    [connectAndPingElectrum, withTimeout],
  );

  const processRefreshRequests = useCallback(
    async (initialRequest: RefreshRequest) => {
      let request: RefreshRequest | null = initialRequest;

      try {
        while (request) {
          refreshingRef.current = true;
          const runId = ++refreshRunIdRef.current;
          let hasSuccessfulUpdates = false;
          const failedWalletIndexes = new Set<number>();

          try {
            if (request.showUpdateStatusIndicator) {
              setWalletTransactionUpdateStatus(WalletTransactionsStatus.ALL);
            }

            if (typeof BlueApp.fetchSenderPaymentCodes === 'function' && request.walletIndexes.length > 0) {
              try {
                const senderPaymentCodesIndex = request.walletIndexes.length === 1 ? request.walletIndexes[0] : undefined;
                await withTimeout('fetchSenderPaymentCodes', REFRESH_TX_TIMEOUT_MS, async () => {
                  await BlueApp.fetchSenderPaymentCodes(senderPaymentCodesIndex);
                });
              } catch (error) {
                if (isRefreshTimeoutError(error)) {
                  console.warn('[refreshAllWalletTransactions] fetchSenderPaymentCodes timed out', error);
                  BlueElectrum.forceDisconnect();
                } else {
                  console.warn('[refreshAllWalletTransactions] fetchSenderPaymentCodes failed', error);
                }
              }
            } else {
              console.warn('[refreshAllWalletTransactions] fetchSenderPaymentCodes is not available');
            }

            for (const walletIndex of request.walletIndexes) {
              if (runId !== refreshRunIdRef.current) {
                console.debug('[refreshAllWalletTransactions] Stale refresh run detected, aborting run', runId);
                break;
              }
              const result = await refreshWalletByIndex(
                walletIndex,
                runId,
                request.explorerFallbackWalletIndexes.includes(walletIndex),
                request.useExtendedTxTimeout,
              );
              if (result.hasSuccessfulUpdate) hasSuccessfulUpdates = true;
              if (result.hasFailure && result.shouldRetry) failedWalletIndexes.add(walletIndex);
            }

            if (hasSuccessfulUpdates && runId === refreshRunIdRef.current) {
              await saveToDisk();
            }
          } catch (error) {
            if (isRefreshTimeoutError(error)) {
              console.warn('[refreshAllWalletTransactions] refresh run timed out', error);
              BlueElectrum.forceDisconnect();
            } else {
              console.warn('[refreshAllWalletTransactions] refresh run failed', error);
            }
          } finally {
            if (runId === refreshRunIdRef.current) {
              setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
            }
            refreshingRef.current = false;
          }

          const pendingRequest = pendingRefreshRequestRef.current;
          pendingRefreshRequestRef.current = null;
          if (pendingRequest) {
            console.debug('[refreshAllWalletTransactions] Processing queued refresh request');
            request = pendingRequest;
            continue;
          }

          if (request.allowRetry && failedWalletIndexes.size > 0) {
            const retryWalletIndexes = [...failedWalletIndexes];
            console.warn('[refreshAllWalletTransactions] Scheduling one-time retry for wallets:', retryWalletIndexes);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              const retryRequest: RefreshRequest = {
                walletIndexes: retryWalletIndexes,
                explorerFallbackWalletIndexes: [],
                useExtendedTxTimeout: false,
                showUpdateStatusIndicator: false,
                allowRetry: false,
              };
              if (refreshingRef.current) {
                pendingRefreshRequestRef.current = mergeRefreshRequests(pendingRefreshRequestRef.current, retryRequest);
                return;
              }
              processRefreshRequests(retryRequest).catch(error => {
                console.warn('[refreshAllWalletTransactions] queued retry failed', error);
              });
            }, REFRESH_RETRY_DELAY_MS);
          }

          request = null;
        }
      } finally {
        const drainResolvers = refreshQueueDrainResolversRef.current;
        refreshQueueDrainResolversRef.current = [];
        drainResolvers.forEach(resolve => resolve());
      }
    },
    [mergeRefreshRequests, refreshWalletByIndex, saveToDisk, withTimeout],
  );

  const enqueueRefreshRequest = useCallback(
    async (request: RefreshRequest) => {
      if (request.walletIndexes.length === 0) return;
      if (refreshingRef.current) {
        pendingRefreshRequestRef.current = mergeRefreshRequests(pendingRefreshRequestRef.current, request);
        console.debug('[refreshAllWalletTransactions] Refresh already in progress, request queued');
        await new Promise<void>(resolve => {
          refreshQueueDrainResolversRef.current.push(resolve);
        });
        return;
      }

      await processRefreshRequests(request);
    },
    [mergeRefreshRequests, processRefreshRequests],
  );

  const transactionSyncCoordinatorRef = useRef<TransactionSyncCoordinator | null>(null);

  const getTransactionSyncCoordinator = useCallback(() => {
    if (transactionSyncCoordinatorRef.current) {
      return transactionSyncCoordinatorRef.current;
    }

    transactionSyncCoordinatorRef.current = new TransactionSyncCoordinator({
      getWallets: () => BlueApp.getWallets(),
      performSync: async (request: SyncRequest) => {
        const walletsList = BlueApp.getWallets();
        const requestedWalletIds = request.walletIds && request.walletIds.length > 0 ? request.walletIds : walletsList.map(w => w.getID());
        const walletIndexes = requestedWalletIds
          .map(walletId => walletsList.findIndex(wallet => wallet.getID() === walletId))
          .filter(index => index >= 0);
        if (walletIndexes.length === 0) return;

        await enqueueRefreshRequest({
          walletIndexes,
          explorerFallbackWalletIndexes: [],
          useExtendedTxTimeout: false,
          showUpdateStatusIndicator: request.priority === 'high',
          allowRetry: true,
        });
      },
      loadSnapshot: async storageKey => {
        try {
          return await BlueApp.getItem(storageKey);
        } catch {
          return null;
        }
      },
      saveSnapshot: async (storageKey, serialized) => {
        try {
          await BlueApp.setItem(storageKey, serialized);
        } catch (error) {
          console.warn('[StorageProvider] Failed to persist transaction head snapshot', error);
        }
      },
    });

    transactionSyncCoordinatorRef.current.initialize().catch(error => {
      console.warn('[StorageProvider] Failed to initialize transaction sync coordinator', error);
    });
    return transactionSyncCoordinatorRef.current;
  }, [enqueueRefreshRequest]);

  useEffect(() => {
    return () => {
      transactionSyncCoordinatorRef.current?.dispose();
      transactionSyncCoordinatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!walletsInitialized) return;
    const coordinator = getTransactionSyncCoordinator();
    coordinator.hydrateFromWallets(BlueApp.getWallets());
  }, [wallets, walletsInitialized, getTransactionSyncCoordinator]);

  const requestTransactionSync = useCallback(
    async (request: SyncRequest) => {
      const coordinator = getTransactionSyncCoordinator();
      await coordinator.requestSync(request);
    },
    [getTransactionSyncCoordinator],
  );

  const getHomeFeed = useCallback(() => {
    return getTransactionSyncCoordinator().getHomeFeed();
  }, [getTransactionSyncCoordinator]);

  const getWalletPage = useCallback(
    (walletId: string, cursor?: WalletPageCursor, pageSize: number = 25) => {
      return getTransactionSyncCoordinator().getWalletPage(walletId, cursor, pageSize);
    },
    [getTransactionSyncCoordinator],
  );

  const subscribeHomeFeed = useCallback(
    (listener: (rows: TransactionRowVM[]) => void) => {
      return getTransactionSyncCoordinator().subscribeHomeFeed(listener);
    },
    [getTransactionSyncCoordinator],
  );

  const subscribeWalletFeed = useCallback(
    (walletId: string, listener: (walletId: string, revision: string, rows: TransactionRowVM[]) => void) => {
      return getTransactionSyncCoordinator().subscribeWalletFeed(walletId, listener);
    },
    [getTransactionSyncCoordinator],
  );

  const prefetchNextWalletPage = useCallback(
    (walletId: string, cursor?: WalletPageCursor, pageSize: number = 25) => {
      getTransactionSyncCoordinator().prefetchNextWalletPage(walletId, cursor, pageSize);
    },
    [getTransactionSyncCoordinator],
  );

  const refreshAllWalletTransactions = useCallback(
    async (lastSnappedTo?: number, showUpdateStatusIndicator: boolean = true) => {
      const walletsList = BlueApp.getWallets();
      const walletIds =
        typeof lastSnappedTo === 'number'
          ? walletsList[lastSnappedTo]
            ? [walletsList[lastSnappedTo].getID()]
            : []
          : walletsList.map(wallet => wallet.getID());

      if (walletIds.length === 0) return;

      await requestTransactionSync({
        scope: typeof lastSnappedTo === 'number' ? 'wallet' : 'all',
        walletIds,
        reason: typeof lastSnappedTo === 'number' ? 'wallet-focus-refresh' : 'all-wallets-refresh',
        priority: showUpdateStatusIndicator ? 'high' : 'normal',
      });
    },
    [requestTransactionSync],
  );

  const fetchAndSaveWalletTransactions = useCallback(
    async (walletID: string) => {
      let noErr = true;
      try {
        if (Date.now() - (_lastTimeTriedToRefetchWallet[walletID] || 0) < 5000) {
          console.debug('[fetchAndSaveWalletTransactions] Re-fetch wallet happens too fast; NOP');
          return;
        }
        _lastTimeTriedToRefetchWallet[walletID] = Date.now();

        setWalletTransactionUpdateStatus(walletID);
        await requestTransactionSync({
          scope: 'wallet',
          walletIds: [walletID],
          reason: 'single-wallet-refresh',
          priority: 'high',
        });
      } catch (err) {
        noErr = false;
        console.error('[fetchAndSaveWalletTransactions] Error:', err);
      } finally {
        setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
      }
      if (noErr) await saveToDisk();
    },
    [requestTransactionSync, saveToDisk],
  );

  const addAndSaveWallet = useCallback(
    async (w: TWallet) => {
      if (wallets.some(i => i.getID() === w.getID())) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ message: 'This wallet has been previously imported.' });
        return;
      }
      const emptyWalletLabel = new LegacyWallet().getLabel();
      if (w.getLabel() === emptyWalletLabel) w.setLabel(loc.wallets.import_imported + ' ' + w.typeReadable);
      w.setUserHasSavedExport(true);
      addWallet(w);
      if (getScanWasBBQR()) {
        // to avoid proxying `useBBQR` through a bunch of screens during import procedure, we use a trick:
        // on add-wallet screen we reset `lastScanWasBBQR` to false. then potentially user scans QR in BBQR format
        // and saves his wallet to storage, in which case execution lands here, where we check last scan and save walletID
        // internally as a marker that this wallet should display animated QR codes in this format
        await setWalletIdMustUseBBQR(w.getID());
      }
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      await saveToDisk();

      presentAlert({
        hapticFeedback: HapticFeedbackTypes.ImpactHeavy,
        message: w.type === WatchOnlyWallet.type ? loc.wallets.import_success_watchonly : loc.wallets.import_success,
      });

      try {
        await w.fetchBalance();
        setWallets([...BlueApp.getWallets()]);
        await saveToDisk();
      } catch (error) {
        console.warn('[addAndSaveWallet] Failed to fetch or persist imported wallet balance:', error);
      }
      try {
        await majorTomToGroundControl(w.getAllExternalAddresses(), [], []);
      } catch (error) {
        console.warn('Failed to setup notifications:', error);
        // Consider if user should be notified of notification setup failure
      }
    },
    [wallets, addWallet, saveToDisk],
  );

  function confirmWalletDeletion(wallet: any, onConfirmed: () => void) {
    triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
    try {
      const balance = formatBalanceWithoutSuffix(wallet.getBalance(), BitcoinUnit.SATS, true);
      presentAlert({
        title: loc.wallets.details_delete_wallet,
        message: loc.formatString(loc.wallets.details_del_wb_q, { balance }),
        buttons: [
          {
            text: loc.wallets.details_delete,
            onPress: () => {
              triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              onConfirmed();
            },
            style: 'destructive',
          },
          {
            text: loc._.cancel,
            onPress: () => {},
            style: 'cancel',
          },
        ],
        options: { cancelable: false },
      });
    } catch (error) {
      // Handle error silently if needed
    }
  }

  const value: StorageContextType = useMemo(
    () => ({
      wallets,
      setWalletsWithNewOrder,
      txMetadata: txMetadata.current,
      counterpartyMetadata: counterpartyMetadata.current,
      saveToDisk,
      getTransactions: BlueApp.getTransactions,
      selectedWalletID,
      addWallet,
      deleteWallet,
      currentSharedCosigner,
      setSharedCosigner: setCurrentSharedCosigner,
      addAndSaveWallet,
      setItem: BlueApp.setItem,
      getItem: BlueApp.getItem,
      fetchWalletBalances: BlueApp.fetchWalletBalances,
      fetchWalletTransactions: BlueApp.fetchWalletTransactions,
      fetchAndSaveWalletTransactions,
      isStorageEncrypted: BlueApp.storageIsEncrypted,
      encryptStorage: BlueApp.encryptStorage,
      startAndDecrypt,
      cachedPassword: BlueApp.cachedPassword,
      getBalance: BlueApp.getBalance,
      walletsInitialized,
      setWalletsInitialized,
      refreshAllWalletTransactions,
      requestTransactionSync,
      getHomeFeed,
      getWalletPage,
      subscribeHomeFeed,
      subscribeWalletFeed,
      prefetchNextWalletPage,
      sleep: BlueApp.sleep,
      createFakeStorage: BlueApp.createFakeStorage,
      resetWallets,
      decryptStorage: BlueApp.decryptStorage,
      isPasswordInUse: BlueApp.isPasswordInUse,
      walletTransactionUpdateStatus,
      setWalletTransactionUpdateStatus,
      handleWalletDeletion,
      confirmWalletDeletion,
    }),
    [
      wallets,
      setWalletsWithNewOrder,
      saveToDisk,
      selectedWalletID,
      addWallet,
      deleteWallet,
      currentSharedCosigner,
      addAndSaveWallet,
      fetchAndSaveWalletTransactions,
      walletsInitialized,
      setWalletsInitialized,
      refreshAllWalletTransactions,
      requestTransactionSync,
      getHomeFeed,
      getWalletPage,
      subscribeHomeFeed,
      subscribeWalletFeed,
      prefetchNextWalletPage,
      resetWallets,
      walletTransactionUpdateStatus,
      handleWalletDeletion,
    ],
  );

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
};
