import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { Alert, findNodeHandle, Image, StyleSheet, Text, View } from 'react-native';
import { getClipboardContent } from '../../blue_modules/clipboard';
import { isDesktop } from '../../blue_modules/environment';
import * as fs from '../../blue_modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { TWallet } from '../../class/wallets/types';
import presentAlert from '../../components/Alert';
import { FButton, FContainer } from '../../components/FloatButtons';
import { useTheme } from '../../components/themes';
import WalletsCarousel from '../../components/WalletsCarousel';
import loc from '../../loc';
import ActionSheet from '../ActionSheet';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useStorage } from '../../hooks/context/useStorage';
import TotalWalletsBalance from '../../components/TotalWalletsBalance';
import { useSettings } from '../../hooks/context/useSettings';
import useMenuElements from '../../hooks/useMenuElements';
import SafeAreaSectionList from '../../components/SafeAreaSectionList';
import { scanQrHelper } from '../../helpers/scan-qr.ts';
import { ACTIVE_HCASH_PROFILE, ACTIVE_HCASH_PROFILE_NAME } from '../../blue_modules/hashcash';

const WalletsListSections = { WALLETS: 'WALLETS' } as const;

type SectionData = {
  key: string;
  data: string[];
};

type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'WalletsList'>;
type RouteProps = RouteProp<DetailViewStackParamList, 'WalletsList'>;

const WalletsList: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { registerTransactionsHandler, unregisterTransactionsHandler } = useMenuElements();
  const { wallets, fetchWalletBalances, resetWallets } = useStorage();
  const { isTotalBalanceEnabled, isElectrumDisabled } = useSettings();
  const { colors, scanImage } = useTheme();
  const navigation = useExtendedNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const walletActionButtonsRef = useRef<any>(null);
  const walletsRef = useRef(wallets);
  const didInitialLoadRef = useRef(false);
  const showTestnetBanner = ACTIVE_HCASH_PROFILE === 'testnet';

  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);

  const stylesHook = StyleSheet.create({
    walletsListWrapper: {
      backgroundColor: colors.backgroundPrimary,
    },
    walletsHeaderSpacer: {
      height: 20,
      backgroundColor: colors.backgroundPrimary,
    },
    testnetBanner: {
      marginTop: 12,
      marginHorizontal: 16,
      marginBottom: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.redText,
      backgroundColor: colors.redBG,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    testnetBannerText: {
      color: colors.redText,
      fontSize: 12,
      fontWeight: '500',
      textAlign: 'center',
    },
    testnetBannerTextBold: {
      fontWeight: '700',
    },
  });

  const refreshWallets = useCallback(
    async (index: number | undefined, showLoadingIndicator = true) => {
      if (isElectrumDisabled) return;
      setIsLoading(showLoadingIndicator);
      try {
        await fetchWalletBalances(index);
        resetWallets();
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    },
    [fetchWalletBalances, isElectrumDisabled, resetWallets],
  );

  const onRefresh = useCallback(() => {
    if (isElectrumDisabled) return;
    refreshWallets(undefined, true);
    // Optimized for Mac option doesn't like RN Refresh component. Menu Elements now handles it for macOS
  }, [isElectrumDisabled, refreshWallets]);

  useEffect(() => {
    if (isElectrumDisabled) {
      didInitialLoadRef.current = false;
      return;
    }

    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;

    refreshWallets(undefined, true).catch(error => {
      console.error(error);
    });
  }, [isElectrumDisabled, refreshWallets]);

  useEffect(() => {
    const screenKey = route.name;
    registerTransactionsHandler(onRefresh, screenKey);

    return () => {
      unregisterTransactionsHandler(screenKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRefresh, registerTransactionsHandler, unregisterTransactionsHandler]);

  useFocusEffect(
    useCallback(() => {
      const screenKey = route.name;

      return () => {
        unregisterTransactionsHandler(screenKey);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unregisterTransactionsHandler]),
  );

  const onBarScanned = useCallback(
    (value: any) => {
      if (!value) return;
      try {
        DeeplinkSchemaMatch.navigationRouteFor({ url: value }, completionValue => {
          triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
          // @ts-ignore: for now
          navigation.navigate(...completionValue);
        });
      } catch (error: any) {
        Alert.alert(loc.send.details_scan_error, error.message);
      }
    },
    [navigation],
  );

  const handleClick = useCallback(
    (item?: TWallet) => {
      if (item?.getID) {
        const walletID = item.getID();
        navigation.navigate('WalletTransactions', {
          walletID,
          walletType: item.type,
        });
      } else {
        navigation.navigate('AddWalletRoot');
      }
    },
    [navigation],
  );

  const handleLongPress = useCallback(() => {
    navigation.navigate('ManageWallets');
  }, [navigation]);

  const renderWalletsStack = useCallback(() => {
    return (
      <WalletsCarousel
        data={wallets}
        extraData={[wallets]}
        onPress={handleClick}
        handleLongPress={handleLongPress}
        onNewWalletPress={handleClick}
        testID="WalletsList"
        horizontal={false}
        isFlatList={false}
        animateChanges={true}
        showLatestTransaction={false}
      />
    );
  }, [handleClick, handleLongPress, wallets]);

  const renderSectionItem = useCallback(
    (item: { section: SectionData }) => {
      switch (item.section.key) {
        case WalletsListSections.WALLETS:
          return renderWalletsStack();
        default:
          return null;
      }
    },
    [renderWalletsStack],
  );

  const renderSectionHeader = useCallback(
    (section: { section: SectionData }) => {
      switch (section.section.key) {
        case WalletsListSections.WALLETS:
          return (
            <View style={stylesHook.walletsListWrapper}>
              {showTestnetBanner ? (
                <View style={stylesHook.testnetBanner}>
                  <Text style={stylesHook.testnetBannerText}>
                    <Text style={stylesHook.testnetBannerTextBold}>{ACTIVE_HCASH_PROFILE_NAME}</Text> Funds Not Real / May Reset
                  </Text>
                </View>
              ) : null}
              {isTotalBalanceEnabled ? <TotalWalletsBalance /> : null}
              <View style={stylesHook.walletsHeaderSpacer} />
            </View>
          );
        default:
          return null;
      }
    },
    [
      isTotalBalanceEnabled,
      showTestnetBanner,
      stylesHook.testnetBanner,
      stylesHook.testnetBannerText,
      stylesHook.testnetBannerTextBold,
      stylesHook.walletsHeaderSpacer,
      stylesHook.walletsListWrapper,
    ],
  );

  const renderScanButton = useCallback(() => {
    if (wallets.length > 0) {
      return (
        <FContainer ref={walletActionButtonsRef.current}>
          <FButton
            onPress={onScanButtonPressed}
            onLongPress={sendButtonLongPress}
            icon={<Image resizeMode="stretch" source={scanImage} />}
            text={loc.send.details_scan}
            testID="HomeScreenScanButton"
          />
        </FContainer>
      );
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanImage, wallets.length]);

  const sectionListKeyExtractor = useCallback((item: string, index: number) => `${item}-${index}`, []);

  const onScanButtonPressed = useCallback(() => {
    scanQrHelper().then(onBarScanned);
  }, [onBarScanned]);

  const pasteFromClipboard = useCallback(async () => {
    onBarScanned(await getClipboardContent());
  }, [onBarScanned]);

  const sendButtonLongPress = useCallback(async () => {
    const isClipboardEmpty = (await getClipboardContent())?.trim().length === 0;

    const options = [loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan];
    if (!isClipboardEmpty) {
      options.push(loc.wallets.paste_from_clipboard);
    }

    const props = { title: loc.send.header, options, cancelButtonIndex: 0 };

    const anchor = findNodeHandle(walletActionButtonsRef.current);

    if (anchor) {
      options.push(String(anchor));
    }

    ActionSheet.showActionSheetWithOptions(props, buttonIndex => {
      switch (buttonIndex) {
        case 0:
          break;
        case 1:
          fs.showImagePickerAndReadImage()
            .then(onBarScanned)
            .catch(error => {
              triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
              presentAlert({ title: loc.errors.error, message: error.message });
            });
          break;
        case 2:
          scanQrHelper().then(onBarScanned);
          break;
        case 3:
          if (!isClipboardEmpty) {
            pasteFromClipboard();
          }
          break;
      }
    });
  }, [onBarScanned, pasteFromClipboard]);

  const refreshProps = isDesktop || isElectrumDisabled ? {} : { refreshing: isLoading, onRefresh };

  const sections: SectionData[] = useMemo(
    () => [
      {
        key: WalletsListSections.WALLETS,
        data: [WalletsListSections.WALLETS],
      },
    ],
    [],
  );

  return (
    <>
      <SafeAreaSectionList<string, SectionData>
        renderItem={renderSectionItem}
        keyExtractor={sectionListKeyExtractor}
        renderSectionHeader={renderSectionHeader}
        initialNumToRender={1}
        renderSectionFooter={() => null}
        sections={sections}
        floatingButtonHeight={70}
        ignoreTopInset={true} // Ignore top inset as the screen header already handles it
        {...refreshProps}
      />
      {renderScanButton()}
    </>
  );
};

export default WalletsList;
