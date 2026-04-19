import { RouteProp, useFocusEffect, useRoute, useLocale } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  findNodeHandle,
  FlatList,
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  RefreshControl,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Icon from '../../components/Icon';
import { isDesktop } from '../../blue_modules/environment';
import * as fs from '../../blue_modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { LightningArkWallet, LightningCustodianWallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import presentAlert, { AlertType } from '../../components/Alert';
import { FButton, FContainer } from '../../components/FloatButtons';
import { useTheme } from '../../components/themes';
import { TransactionListItem } from '../../components/TransactionListItem';
import TransactionsNavigationHeader, { actionKeys } from '../../components/TransactionsNavigationHeader';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc, { formatBalance } from '../../loc';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import ActionSheet from '../ActionSheet';
import { useStorage } from '../../hooks/context/useStorage';
import WatchOnlyWarning from '../../components/WatchOnlyWarning';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { TWallet } from '../../class/wallets/types';
import { TransactionRowVM, WalletPageCursor } from '../../class/transaction-sync-coordinator';
import getWalletTransactionsOptions, { WalletTransactionsRouteProps } from '../../navigation/helpers/getWalletTransactionsOptions';
import { presentWalletExportReminder } from '../../helpers/presentWalletExportReminder';
import selectWallet from '../../helpers/select-wallet';
import assert from 'assert';
import useMenuElements from '../../hooks/useMenuElements';
import { useSettings } from '../../hooks/context/useSettings';
import useWalletSubscribe from '../../hooks/useWalletSubscribe';
import { getClipboardContent } from '../../blue_modules/clipboard';
import HandOffComponent from '../../components/HandOffComponent';
import { HandOffActivityType } from '../../components/types';
import WalletGradient from '../../class/wallet-gradient';
import { LIGHTNING_ENABLED } from '../../blue_modules/hashcash';

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);
const WALLET_PAGE_SIZE = 25;

const isSameTransactionRows = (left: TransactionRowVM[], right: TransactionRowVM[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const leftRow = left[index];
    const rightRow = right[index];
    if (!leftRow || !rightRow) return false;
    if (leftRow.txid !== rightRow.txid) return false;
    if ((leftRow.confirmations ?? 0) !== (rightRow.confirmations ?? 0)) return false;
    if ((leftRow.timestamp ?? 0) !== (rightRow.timestamp ?? 0)) return false;
    if (leftRow.hydrationLevel !== rightRow.hydrationLevel) return false;
  }
  return true;
};

type RouteProps = RouteProp<DetailViewStackParamList, 'WalletTransactions'>;

type WalletTransactionsProps = NativeStackScreenProps<DetailViewStackParamList, 'WalletTransactions'>;

const WalletTransactions: React.FC<WalletTransactionsProps> = ({ route }: { route: WalletTransactionsRouteProps }) => {
  const { wallets, saveToDisk, requestTransactionSync, getWalletPage, subscribeWalletFeed, prefetchNextWalletPage } = useStorage();
  const { registerTransactionsHandler, unregisterTransactionsHandler } = useMenuElements();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const { direction } = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const { params, name } = useRoute<RouteProps>();
  const { walletID } = params;
  const wallet = useWalletSubscribe(walletID);
  const [pagedTransactions, setPagedTransactions] = useState<TransactionRowVM[]>([]);
  const [nextCursor, setNextCursor] = useState<WalletPageCursor | undefined>(undefined);
  const [lockedRevision, setLockedRevision] = useState<string>('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPullToRefreshing, setIsPullToRefreshing] = useState(false);
  const navigation = useExtendedNavigation();
  const { setOptions, navigate } = navigation;
  const theme = useTheme();
  const { colors } = theme;
  const { isElectrumDisabled } = useSettings();
  const transactionDisplayUnit = BitcoinUnit.BTC;
  const walletActionButtonsRef = useRef<View>(null);
  const [balance, setBalance] = useState(wallet.getBalance());
  const flatListRef = useRef<FlatList<TransactionRowVM>>(null);
  const headerRef = useRef<View>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const isLoadingRef = useRef(false);
  const initialAutoRefreshWalletRef = useRef<string | null>(null);
  const lockedRevisionRef = useRef('');
  const pagedTransactionsRef = useRef<TransactionRowVM[]>([]);

  const setLoadingState = useCallback((value: boolean) => {
    isLoadingRef.current = value;
    setIsLoading(value);
  }, []);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    lockedRevisionRef.current = lockedRevision;
  }, [lockedRevision]);

  useEffect(() => {
    pagedTransactionsRef.current = pagedTransactions;
  }, [pagedTransactions]);

  const stylesHook = StyleSheet.create({
    listHeaderText: {
      color: colors.foregroundColor,
    },
    listFooterStyle: {
      backgroundColor: colors.background,
    },
    backgroundContainer: {
      backgroundColor: colors.background,
    },
    gradientBackground: {
      backgroundColor: headerHeight > 0 ? WalletGradient.headerColorFor(wallet.type) : colors.background,
      height: headerHeight > 0 ? headerHeight : '30%',
    },
    emptyTxs: {
      color: colors.buttonDisabledTextColor,
    },
    emptyTxsLightning: {
      color: colors.buttonDisabledTextColor,
    },
    loadMoreButton: {
      backgroundColor: colors.backgroundSurfaceSecondary,
    },
    loadMoreButtonText: {
      color: colors.backgroundSurface,
    },
    sendIcon: { transform: [{ rotate: direction === 'rtl' ? '-225deg' : '225deg' }] },
    receiveIcon: { transform: [{ rotate: direction === 'rtl' ? '-45deg' : '45deg' }] },
  });

  useFocusEffect(
    useCallback(() => {
      setOptions(getWalletTransactionsOptions({ route, theme }));
    }, [route, setOptions, theme]),
  );

  const onBarCodeRead = useCallback(
    (ret?: { data?: any }) => {
      if (isLoadingRef.current) return;

      setLoadingState(true);
      const parameters = {
        walletID,
        uri: ret?.data ? ret.data : ret,
      };
      if (wallet.chain === Chain.ONCHAIN) {
        navigate('SendDetailsRoot', { screen: 'SendDetails', params: parameters });
      } else {
        if (!LIGHTNING_ENABLED) {
          setLoadingState(false);
          presentAlert({ message: 'Lightning is disabled for HashCash.' });
          return;
        }
        navigate('ScanLNDInvoiceRoot', { screen: 'ScanLNDInvoice', params: parameters });
      }
      setLoadingState(false);
    },
    [navigate, setLoadingState, wallet.chain, walletID],
  );

  useEffect(() => {
    const data = route.params?.onBarScanned;
    if (data) {
      onBarCodeRead({ data });
      navigation.setParams({ onBarScanned: undefined });
    }
  }, [navigation, onBarCodeRead, route.params]);

  const loadFirstPage = useCallback(
    (revision?: string) => {
      const firstCursor =
        revision && revision.length > 0
          ? {
              walletId: walletID,
              revision,
              offset: 0,
            }
          : undefined;
      const page = getWalletPage(walletID, firstCursor, WALLET_PAGE_SIZE);
      setPagedTransactions(previousRows => (isSameTransactionRows(previousRows, page.rows) ? previousRows : page.rows));
      pagedTransactionsRef.current = page.rows;
      setNextCursor(page.nextCursor);
      setLockedRevision(page.revision);
      lockedRevisionRef.current = page.revision;
      return page;
    },
    [getWalletPage, walletID],
  );

  const loadMoreTransactions = useCallback(() => {
    if (!nextCursor) return;
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = getWalletPage(walletID, nextCursor, WALLET_PAGE_SIZE);
      if (page.rows.length > 0) {
        setPagedTransactions(prev => {
          const merged = prev.concat(page.rows);
          pagedTransactionsRef.current = merged;
          return merged;
        });
      }
      setNextCursor(page.nextCursor);
      if (page.nextCursor) {
        prefetchNextWalletPage(walletID, page.nextCursor, WALLET_PAGE_SIZE);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [getWalletPage, isLoadingMore, nextCursor, prefetchNextWalletPage, walletID]);

  const refreshTransactions = useCallback(
    async (isManualRefresh = false) => {
      if (isElectrumDisabled || isLoadingRef.current) return;
      setLoadingState(true);
      try {
        await requestTransactionSync({
          scope: 'wallet',
          walletIds: [walletID],
          reason: isManualRefresh ? 'wallet-detail-manual-refresh' : 'wallet-detail-auto-refresh',
          priority: isManualRefresh ? 'high' : 'normal',
        });
        loadFirstPage();
      } catch (error) {
        presentAlert({
          message: (error as Error)?.message || String(error),
          type: AlertType.Toast,
        });
      } finally {
        setLoadingState(false);
      }
    },
    [isElectrumDisabled, loadFirstPage, requestTransactionSync, setLoadingState, walletID],
  );

  const handlePullToRefresh = useCallback(async () => {
    if (isElectrumDisabled || isLoadingRef.current) return;
    setIsPullToRefreshing(true);
    try {
      await refreshTransactions(true);
    } finally {
      setIsPullToRefreshing(false);
    }
  }, [isElectrumDisabled, refreshTransactions]);

  useEffect(() => {
    initialAutoRefreshWalletRef.current = null;
    setLockedRevision('');
    lockedRevisionRef.current = '';
    setNextCursor(undefined);
    pagedTransactionsRef.current = [];
  }, [walletID]);

  useEffect(() => {
    if (isElectrumDisabled) return;
    const firstPage = loadFirstPage();
    if (firstPage.rows.length > 0) {
      initialAutoRefreshWalletRef.current = walletID;
      return;
    }
    if (initialAutoRefreshWalletRef.current === walletID) return;
    initialAutoRefreshWalletRef.current = walletID;
    refreshTransactions(false).catch(console.error);
  }, [isElectrumDisabled, loadFirstPage, refreshTransactions, walletID]);

  useEffect(() => {
    return subscribeWalletFeed(walletID, (updatedWalletId, revision) => {
      if (updatedWalletId !== walletID) return;
      setLoadingState(true);

      try {
        const currentLength = Math.max(pagedTransactionsRef.current.length, WALLET_PAGE_SIZE);
        const currentPage = getWalletPage(
          walletID,
          {
            walletId: walletID,
            revision,
            offset: 0,
          },
          currentLength,
        );
        setPagedTransactions(previousRows => (isSameTransactionRows(previousRows, currentPage.rows) ? previousRows : currentPage.rows));
        pagedTransactionsRef.current = currentPage.rows;
        setNextCursor(currentPage.nextCursor);
        setLockedRevision(revision);
        lockedRevisionRef.current = revision;
      } finally {
        setLoadingState(false);
      }
    });
  }, [getWalletPage, setLoadingState, subscribeWalletFeed, walletID]);

  const isLightning = useCallback((): boolean => (LIGHTNING_ENABLED && wallet.chain === Chain.OFFCHAIN) || false, [wallet]);
  const renderListFooterComponent = useCallback(() => {
    const hasMoreTransactions = !!nextCursor;
    if (!hasMoreTransactions) return null;

    return (
      <View style={stylesHook.listFooterStyle}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Load next ${WALLET_PAGE_SIZE} transactions`}
          onPress={loadMoreTransactions}
          disabled={isLoadingMore}
          style={[styles.loadMoreButton, stylesHook.loadMoreButton, isLoadingMore ? styles.loadMoreButtonDisabled : null]}
        >
          {isLoadingMore ? (
            <ActivityIndicator style={styles.loadMoreSpinner} />
          ) : (
            <Text style={[styles.loadMoreButtonText, stylesHook.loadMoreButtonText]}>{`Load next ${WALLET_PAGE_SIZE}`}</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }, [isLoadingMore, loadMoreTransactions, nextCursor, stylesHook.listFooterStyle, stylesHook.loadMoreButton, stylesHook.loadMoreButtonText]);

  const navigateToSendScreen = () => {
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID,
      },
    });
  };

  const onWalletSelect = useCallback(
    async (selectedWallet: TWallet) => {
      assert(
        wallet.type === LightningCustodianWallet.type || wallet.type === LightningArkWallet.type,
        `internal error, wallet is not ${LightningCustodianWallet.type} or ${LightningArkWallet.type}`,
      );

      // getting refill address, either cached or from the server:
      let toAddress;
      if (wallet.refill_addressess.length > 0) {
        toAddress = wallet.refill_addressess[0];
      } else {
        try {
          await wallet.fetchBtcAddress();
          toAddress = wallet.refill_addressess[0];
        } catch (Err) {
          return presentAlert({ message: (Err as Error).message, type: AlertType.Toast });
        }
      }

      // navigating to pay screen where user can pay to refill address:
      navigate('SendDetailsRoot', {
        screen: 'SendDetails',
        params: {
          transactionMemo: loc.lnd.refill_lnd_balance,
          address: toAddress,
          walletID: selectedWallet.getID(),
        },
      });
    },
    [navigate, wallet],
  );

  const navigateToViewEditCosigners = useCallback(() => {
    navigate('ViewEditMultisigCosigners', {
      walletID,
    });
  }, [navigate, walletID]);

  const onManageFundsPressed = useCallback(
    (id?: string) => {
      if (!LIGHTNING_ENABLED) {
        presentAlert({ message: 'Lightning is disabled for HashCash.' });
        return;
      }
      if (id === actionKeys.Refill) {
        const availableWallets = wallets.filter(item => item.chain === Chain.ONCHAIN && item.allowSend());
        if (availableWallets.length === 0) {
          presentAlert({ message: loc.lnd.refill_create });
        } else {
          selectWallet(navigation, name, Chain.ONCHAIN).then(onWalletSelect);
        }
      } else if (id === actionKeys.RefillWithExternalWallet) {
        navigate('ReceiveDetails', { walletID });
      }
    },
    [name, navigate, navigation, onWalletSelect, walletID, wallets],
  );

  const getItemLayout = (_: any, index: number) => ({
    length: 64,
    offset: 64 * index,
    index,
  });

  const renderItem = useCallback(
    // eslint-disable-next-line react/no-unused-prop-types
    ({ item }: { item: TransactionRowVM }) => (
      <TransactionListItem key={item.hash} item={item} itemPriceUnit={transactionDisplayUnit} walletID={walletID} />
    ),
    [transactionDisplayUnit, walletID],
  );

  const choosePhoto = () => {
    fs.showImagePickerAndReadImage()
      .then(data => {
        if (data) {
          onBarCodeRead({ data });
        }
      })
      .catch(error => {
        console.log(error);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.errors.error, message: error.message });
      });
  };

  const _keyExtractor = useCallback((item: TransactionRowVM, index: number) => item.txid || item.hash || index.toString(), []);

  const pasteFromClipboard = async () => {
    onBarCodeRead({ data: await getClipboardContent() });
  };

  const sendButtonPress = () => {
    if (wallet.chain === Chain.OFFCHAIN) {
      if (!LIGHTNING_ENABLED) {
        return presentAlert({ message: 'Lightning is disabled for HashCash.' });
      }
      return navigate('ScanLNDInvoiceRoot', { screen: 'ScanLNDInvoice', params: { walletID } });
    }

    if (wallet.type === WatchOnlyWallet.type && wallet.isHd() && !wallet.useWithHardwareWalletEnabled()) {
      return Alert.alert(
        loc.wallets.details_title,
        loc.transactions.enable_offline_signing,
        [
          {
            text: loc._.ok,
            onPress: async () => {
              wallet.setUseWithHardwareWalletEnabled(true);
              await saveToDisk();
              navigateToSendScreen();
            },
            style: 'default',
          },
          { text: loc._.cancel, onPress: () => {}, style: 'cancel' },
        ],
        { cancelable: false },
      );
    }

    navigateToSendScreen();
  };

  const sendButtonLongPress = async () => {
    const isClipboardEmpty = (await getClipboardContent())?.trim().length === 0;
    const options = [loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan];
    const cancelButtonIndex = 0;

    if (!isClipboardEmpty) {
      options.push(loc.wallets.paste_from_clipboard);
    }

    ActionSheet.showActionSheetWithOptions(
      {
        title: loc.send.header,
        options,
        cancelButtonIndex,
        anchor: findNodeHandle(walletActionButtonsRef.current) ?? undefined,
      },
      async buttonIndex => {
        switch (buttonIndex) {
          case 0:
            break;
          case 1: {
            choosePhoto();
            break;
          }
          case 2: {
            navigate('ScanQRCode', {
              showImportFileButton: true,
            });
            break;
          }
          case 3:
            if (!isClipboardEmpty) {
              pasteFromClipboard();
            }
            break;
        }
      },
    );
  };

  useEffect(() => {
    const screenKey = `WalletTransactions-${walletID}`;
    registerTransactionsHandler(() => refreshTransactions(true), screenKey);

    return () => {
      unregisterTransactionsHandler(screenKey);
    };
  }, [walletID, refreshTransactions, registerTransactionsHandler, unregisterTransactionsHandler]);

  useFocusEffect(
    useCallback(() => {
      const screenKey = `WalletTransactions-${walletID}`;

      return () => {
        unregisterTransactionsHandler(screenKey);
      };
    }, [walletID, unregisterTransactionsHandler]),
  );

  useEffect(() => {
    const interval = setInterval(() => setBalance(wallet.getBalance()), 1000);
    return () => clearInterval(interval);
  }, [wallet]);

  const walletBalance = useMemo(() => {
    if (wallet.hideBalance) return '';
    if (!Number.isFinite(balance)) return '';
    const formatted = formatBalance(balance, transactionDisplayUnit, true);
    return formatted || '0';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, wallet.hideBalance, transactionDisplayUnit, balance]);

  const handleScroll = useCallback(
    (event: any) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const combinedHeight = 180;
      if (offsetY < combinedHeight) {
        setOptions({ ...getWalletTransactionsOptions({ route, theme }), headerTitle: undefined });
      } else {
        navigation.setOptions({
          headerTitle: `${wallet.getLabel()} ${walletBalance}`,
        });
      }
    },
    [navigation, wallet, walletBalance, setOptions, route, theme],
  );

  const measureHeaderHeight = useCallback(() => {
    if (!headerRef.current) {
      // If header ref is not available, use default background
      setHeaderHeight(0);
      return;
    }

    headerRef.current.measure((x, y, width, height, pageX, pageY) => {
      // Check if the header is actually visible
      if (height === 0 || pageY < 0) {
        // Header is not visible, use default background
        setHeaderHeight(0);
        return;
      }

      const fullHeight = pageY + height;
      if (fullHeight > 0) {
        setHeaderHeight(fullHeight);
      }
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(measureHeaderHeight, 100);
    return () => clearTimeout(timer);
  }, [walletID, measureHeaderHeight]);

  const ListHeaderComponent = useCallback(
    () => (
      <View ref={headerRef} onLayout={measureHeaderHeight}>
        <TransactionsNavigationHeader
          wallet={wallet}
          onWalletBalanceVisibilityChange={async isShouldBeVisible => {
            const isBiometricsEnabled = await isBiometricUseCapableAndEnabled();
            if (wallet.hideBalance && isBiometricsEnabled) {
              const unlocked = await unlockWithBiometrics();
              if (!unlocked) throw new Error('Biometrics failed');
            }
            wallet.hideBalance = isShouldBeVisible;
            await saveToDisk();
          }}
          onManageFundsPressed={id => {
            if (wallet.type === MultisigHDWallet.type) {
              navigateToViewEditCosigners();
            } else if (wallet.type === LightningCustodianWallet.type || wallet.type === LightningArkWallet.type) {
              if (wallet.getUserHasSavedExport()) {
                if (!id) return;
                onManageFundsPressed(id);
              } else {
                presentWalletExportReminder()
                  .then(async () => {
                    if (!id) return;
                    wallet.setUserHasSavedExport(true);
                    await saveToDisk();
                    onManageFundsPressed(id);
                  })
                  .catch(() => {
                    navigate('WalletExport', {
                      walletID,
                    });
                  });
              }
            }
          }}
        />
        <>
          <View style={[styles.flex, stylesHook.backgroundContainer]}>
            <View style={styles.listHeaderTextRow}>
              <Text style={[styles.listHeaderText, stylesHook.listHeaderText]}>{loc.transactions.list_title}</Text>
            </View>
          </View>
          <View style={stylesHook.backgroundContainer}>
            {wallet.type === WatchOnlyWallet.type && wallet.isWatchOnlyWarningVisible && (
              <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                <WatchOnlyWarning
                  handleDismiss={() => {
                    wallet.isWatchOnlyWarningVisible = false;
                    saveToDisk();
                  }}
                />
              </Animated.View>
            )}
          </View>
        </>
      </View>
    ),
    [
      wallet,
      measureHeaderHeight,
      stylesHook.backgroundContainer,
      stylesHook.listHeaderText,
      saveToDisk,
      isBiometricUseCapableAndEnabled,
      navigateToViewEditCosigners,
      onManageFundsPressed,
      navigate,
      walletID,
    ],
  );

  useEffect(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [walletID]);

  return (
    <View style={[styles.flex, stylesHook.backgroundContainer]}>
      <View style={[styles.refreshIndicatorBackground, stylesHook.gradientBackground]} testID="TransactionsListView" />
      <FlatList<TransactionRowVM>
        ref={flatListRef}
        getItemLayout={getItemLayout}
        updateCellsBatchingPeriod={50}
        ListFooterComponent={renderListFooterComponent}
        data={pagedTransactions}
        extraData={[wallet.hideBalance, lockedRevision]}
        keyExtractor={_keyExtractor}
        renderItem={renderItem}
        initialNumToRender={10}
        removeClippedSubviews
        contentContainerStyle={stylesHook.backgroundContainer}
        contentInset={{ top: 0, left: 0, bottom: 90, right: 0 }}
        maxToRenderPerBatch={10}
        onScroll={handleScroll}
        windowSize={15}
        scrollEventThrottle={16}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={
          <ScrollView style={[styles.emptyTxsContainer, stylesHook.backgroundContainer]} contentContainerStyle={styles.scrollViewContent}>
            {isLoading && !isPullToRefreshing ? (
              <View style={styles.loadingStateContainer}>
                <ActivityIndicator style={styles.loadingStateSpinner} />
                <Text numberOfLines={0} style={[styles.emptyTxs, stylesHook.emptyTxs]} testID="TransactionsListEmpty">
                  Loading transactions...
                </Text>
              </View>
            ) : (
              <>
                <Text numberOfLines={0} style={[styles.emptyTxs, stylesHook.emptyTxs]} testID="TransactionsListEmpty">
                  {(isLightning() && loc.wallets.list_empty_txs1_lightning) || loc.wallets.list_empty_txs1}
                </Text>
                {isLightning() && <Text style={[styles.emptyTxsLightning, stylesHook.emptyTxsLightning]}>{loc.wallets.list_empty_txs2_lightning}</Text>}
              </>
            )}
          </ScrollView>
        }
        refreshControl={
          !isDesktop && !isElectrumDisabled ? (
            <RefreshControl refreshing={isPullToRefreshing} onRefresh={handlePullToRefresh} tintColor={colors.msSuccessCheck} />
          ) : undefined
        }
      />

      <FContainer ref={walletActionButtonsRef}>
        {wallet.allowReceive() && (
          <FButton
            testID="ReceiveButton"
            text={loc.receive.header}
            onPress={() => {
              if (wallet.chain === Chain.OFFCHAIN) {
                if (!LIGHTNING_ENABLED) {
                  presentAlert({ message: 'Lightning is disabled for HashCash.' });
                  return;
                }
                navigate('LNDCreateInvoiceRoot', { screen: 'LNDCreateInvoice', params: { walletID } });
              } else {
                navigate('ReceiveDetails', { walletID });
              }
            }}
            icon={
              <View style={styles.iconContainer}>
                <Icon
                  name="arrow-down"
                  size={buttonFontSize}
                  type="font-awesome"
                  color={colors.buttonAlternativeTextColor}
                  style={stylesHook.receiveIcon}
                />
              </View>
            }
          />
        )}
        {(wallet.allowSend() || (wallet.type === WatchOnlyWallet.type && wallet.isHd())) && (
          <FButton
            onLongPress={sendButtonLongPress}
            onPress={sendButtonPress}
            text={loc.send.header}
            testID="SendButton"
            icon={
              <View style={styles.iconContainer}>
                <Icon
                  name="arrow-down"
                  size={buttonFontSize}
                  type="font-awesome"
                  color={colors.buttonAlternativeTextColor}
                  style={stylesHook.sendIcon}
                />
              </View>
            }
          />
        )}
      </FContainer>
      {wallet.chain === Chain.ONCHAIN && wallet.type !== MultisigHDWallet.type && wallet.getXpub && wallet.getXpub() ? (
        <HandOffComponent
          title={wallet.getLabel()}
          type={HandOffActivityType.Xpub}
          url={`https://www.blockonomics.co/#/search?q=${wallet.getXpub()}`}
        />
      ) : null}
    </View>
  );
};

export default WalletTransactions;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollViewContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 500 },
  loadingStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  loadingStateSpinner: {
    marginBottom: 10,
  },
  listHeaderTextRow: { flex: 1, margin: 16, flexDirection: 'row', justifyContent: 'space-between' },
  listHeaderText: { marginTop: 8, marginBottom: 8, fontWeight: 'bold', fontSize: 24 },
  refreshIndicatorBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  emptyTxsContainer: { height: '10%', minHeight: '10%', flex: 1 },
  emptyTxs: { fontSize: 18, textAlign: 'center', marginVertical: 16 },
  emptyTxsLightning: { fontSize: 18, textAlign: 'center', fontWeight: '600' },
  loadMoreButton: {
    alignItems: 'center',
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  loadMoreButtonDisabled: {
    opacity: 0.8,
  },
  loadMoreButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadMoreSpinner: {
    marginVertical: 2,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: buttonFontSize * 1.5,
    height: buttonFontSize * 1.5,
    overflow: 'visible',
  },
});
