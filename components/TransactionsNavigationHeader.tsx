import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { LightningArkWallet, LightningCustodianWallet, MultisigHDWallet } from '../class';
import WalletGradient from '../class/wallet-gradient';
import { TWallet } from '../class/wallets/types';
import loc, { formatBalance } from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';
import { BlurredBalanceView } from './BlurredBalanceView';
import ToolTipMenu from './TooltipMenu';
import useAnimateOnChange from '../hooks/useAnimateOnChange';
import { useLocale } from '@react-navigation/native';
import { getBalanceDisplayParts } from '../blue_modules/balanceDisplay';
import { useTheme } from './themes';

interface TransactionsNavigationHeaderProps {
  wallet: TWallet;
  onManageFundsPressed?: (id?: string) => void;
  onWalletBalanceVisibilityChange?: (isShouldBeVisible: boolean) => void;
}

const TransactionsNavigationHeader: React.FC<TransactionsNavigationHeaderProps> = ({
  wallet,
  onManageFundsPressed,
  onWalletBalanceVisibilityChange,
}) => {
  const { colors } = useTheme();
  const { hideBalance } = wallet;
  const [allowOnchainAddress, setAllowOnchainAddress] = useState(false);
  const { direction } = useLocale();
  const balanceOpacity = useSharedValue(1);
  const balanceTranslateY = useSharedValue(0);
  const previousBalance = useRef<string | undefined>(undefined);

  const verifyIfWalletAllowsOnchainAddress = useCallback(() => {
    if (wallet.type === LightningCustodianWallet.type || wallet.type === LightningArkWallet.type) {
      wallet
        .allowOnchainAddress()
        .then((value: boolean) => setAllowOnchainAddress(value))
        .catch(() => {
          console.error('This LNDhub wallet does not have an onchain address API.');
          setAllowOnchainAddress(false);
        });
    }
  }, [wallet]);

  useEffect(() => {
    verifyIfWalletAllowsOnchainAddress();
  }, [wallet, verifyIfWalletAllowsOnchainAddress]);

  const handleCopyPress = useCallback(() => {
    const value = formatBalance(wallet.getBalance(), BitcoinUnit.BTC, true);
    if (value) {
      Clipboard.setString(value);
    }
  }, [wallet]);

  const handleBalanceVisibility = useCallback(() => {
    onWalletBalanceVisibilityChange?.(!hideBalance);
  }, [onWalletBalanceVisibilityChange, hideBalance]);

  const handleManageFundsPressed = useCallback(
    (actionKeyID?: string) => {
      if (onManageFundsPressed) {
        onManageFundsPressed(actionKeyID);
      }
    },
    [onManageFundsPressed],
  );

  const onPressMenuItem = useCallback(
    (id: string) => {
      if (id === 'walletBalanceVisibility') {
        handleBalanceVisibility();
      } else if (id === 'copyToClipboard') {
        handleCopyPress();
      }
    },
    [handleBalanceVisibility, handleCopyPress],
  );

  const toolTipActions = useMemo(() => {
    return [
      {
        id: actionKeys.Refill,
        text: loc.lnd.refill,
        icon: actionIcons.Refill,
      },
      {
        id: actionKeys.RefillWithExternalWallet,
        text: loc.lnd.refill_external,
        icon: actionIcons.RefillWithExternalWallet,
      },
    ];
  }, []);

  const currentBalance = wallet ? wallet.getBalance() : 0;
  const formattedBalance = useMemo(() => formatBalance(currentBalance, BitcoinUnit.BTC, true), [currentBalance]);
  const balanceParts = useMemo(() => getBalanceDisplayParts(formattedBalance, 4, 8), [formattedBalance]);
  const safeBalance = wallet.hideBalance ? undefined : `${balanceParts.numeric}:${balanceParts.hiddenDecimals}`;

  useEffect(() => {
    if (hideBalance) {
      previousBalance.current = undefined;
      balanceOpacity.value = 1;
      balanceTranslateY.value = 0;
      return;
    }

    if (previousBalance.current !== undefined && previousBalance.current !== safeBalance) {
      balanceOpacity.value = 0;
      balanceTranslateY.value = 6;
      balanceOpacity.value = withTiming(1, { duration: 180 });
      balanceTranslateY.value = withSpring(0, { damping: 16, stiffness: 220 });
    }

    previousBalance.current = safeBalance;
  }, [safeBalance, hideBalance, balanceOpacity, balanceTranslateY]);

  const balanceAnimationKey = useMemo(
    () => `${wallet.getID?.() ?? ''}-${hideBalance}-${safeBalance ?? ''}`,
    [safeBalance, hideBalance, wallet],
  );
  const balanceAnimatedStyle = useAnimateOnChange(balanceAnimationKey);

  const animatedBalanceTextStyle = useAnimatedStyle(() => ({
    opacity: balanceOpacity.value,
    transform: [{ translateY: balanceTranslateY.value }],
  }));

  const toolTipWalletBalanceActions = useMemo(() => {
    return hideBalance
      ? [
          {
            id: 'walletBalanceVisibility',
            text: loc.transactions.details_balance_show,
            icon: {
              iconValue: 'eye',
            },
          },
        ]
      : [
          {
            id: 'walletBalanceVisibility',
            text: loc.transactions.details_balance_hide,
            icon: {
              iconValue: 'eye.slash',
            },
          },
          {
            id: 'copyToClipboard',
            text: loc.transactions.details_copy,
            icon: {
              iconValue: 'doc.on.doc',
            },
          },
        ];
  }, [hideBalance]);

  const imageSource = useMemo(() => {
    switch (wallet.type) {
      case LightningCustodianWallet.type:
      case LightningArkWallet.type:
        return direction === 'rtl' ? require('../img/lnd-shape-rtl.png') : require('../img/lnd-shape.png');
      case MultisigHDWallet.type:
        return direction === 'rtl' ? require('../img/vault-shape-rtl.png') : require('../img/vault-shape.png');
      default:
        return require('../img/icon.png');
    }
  }, [direction, wallet.type]);
  const stylesHook = useMemo(
    () => ({
      walletLabel: {
        color: colors.textPrimary,
      },
      walletBalanceText: {
        color: colors.textPrimary,
      },
      manageFundsButton: {
        backgroundColor: colors.backgroundSurfaceSecondary,
      },
      manageFundsButtonText: {
        color: colors.textPrimary,
      },
      walletPreferredUnitView: {
        backgroundColor: colors.backgroundSurfaceSecondary,
      },
      walletPreferredUnitText: {
        color: colors.textPrimary,
      },
    }),
    [colors.backgroundSurfaceSecondary, colors.textPrimary],
  );

  return (
    <LinearGradient colors={WalletGradient.gradientsFor(wallet.type)} style={styles.lineaderGradient}>
      <ImageBackground source={imageSource} style={styles.chainIcon} />

      <View style={styles.contentContainer}>
        <Text testID="WalletLabel" numberOfLines={1} style={[styles.walletLabel, stylesHook.walletLabel, { writingDirection: direction }]}>
          {wallet.getLabel()}
        </Text>
        <Animated.View style={[styles.walletBalanceAndUnitContainer, balanceAnimatedStyle]}>
          <ToolTipMenu
            shouldOpenOnLongPress
            isButton
            enableAndroidRipple={false}
            buttonStyle={styles.walletBalance}
            onPressMenuItem={onPressMenuItem}
            actions={toolTipWalletBalanceActions}
          >
            <View style={styles.walletBalance}>
              {hideBalance ? (
                <BlurredBalanceView />
              ) : (
                <View key={`wallet-balance-textwrap-${wallet.getID?.() ?? ''}-${safeBalance ?? ''}`}>
                  <Animated.Text
                    key={`wallet-balance-text-${wallet.getID?.() ?? ''}-${safeBalance ?? ''}`} // force recreation on balance change for RTL correctness
                    testID="WalletBalance"
                    numberOfLines={1}
                    minimumFontScale={0.5}
                    adjustsFontSizeToFit
                    style={[styles.walletBalanceText, stylesHook.walletBalanceText, animatedBalanceTextStyle]}
                  >
                    {balanceParts.numeric}
                    {balanceParts.hiddenDecimals > 0 ? (
                      <Text style={styles.walletBalanceSuperscript}>{balanceParts.hiddenDecimals}</Text>
                    ) : null}
                  </Animated.Text>
                </View>
              )}
            </View>
          </ToolTipMenu>
          <View style={[styles.walletPreferredUnitView, stylesHook.walletPreferredUnitView]}>
            <Text style={[styles.walletPreferredUnitText, stylesHook.walletPreferredUnitText]}>HCASH</Text>
          </View>
        </Animated.View>
        {(wallet.type === LightningCustodianWallet.type || wallet.type === LightningArkWallet.type) && allowOnchainAddress && (
          <ToolTipMenu
            shouldOpenOnLongPress
            isButton
            onPressMenuItem={handleManageFundsPressed}
            actions={toolTipActions}
            buttonStyle={[styles.manageFundsButton, stylesHook.manageFundsButton]}
          >
            <Text style={[styles.manageFundsButtonText, stylesHook.manageFundsButtonText]}>{loc.lnd.title}</Text>
          </ToolTipMenu>
        )}
        {wallet.type === MultisigHDWallet.type && (
          <TouchableOpacity style={[styles.manageFundsButton, stylesHook.manageFundsButton]} accessibilityRole="button" onPress={() => handleManageFundsPressed()}>
            <Text style={[styles.manageFundsButtonText, stylesHook.manageFundsButtonText]}>{loc.multisig.manage_keys}</Text>
          </TouchableOpacity>
        )}
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  lineaderGradient: {
    minHeight: 140,
    justifyContent: 'center',
  },
  contentContainer: {
    padding: 15,
  },
  chainIcon: {
    width: 99,
    height: 94,
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  walletLabel: {
    fontSize: 19,
    marginBottom: 10,
  },
  walletBalance: {
    flexShrink: 1,
    marginRight: 6,
  },
  manageFundsButton: {
    marginTop: 14,
    marginBottom: 10,
    borderRadius: 9,
    minHeight: 39,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  manageFundsButtonText: {
    fontWeight: '500',
    fontSize: 14,
    padding: 12,
  },
  walletBalanceAndUnitContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10, // Ensure there's some padding to the right
  },
  walletBalanceText: {
    fontWeight: 'bold',
    fontSize: 36,
    flexShrink: 1, // Allow the text to shrink if there's not enough space
  },
  walletBalanceSuperscript: {
    fontSize: 12,
    lineHeight: 12,
    fontWeight: '700',
    position: 'relative',
    top: -10,
    includeFontPadding: false,
  },
  walletPreferredUnitView: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    minHeight: 35,
    minWidth: 65,
  },
  walletPreferredUnitText: {
    fontWeight: '600',
  },
});

export const actionKeys = {
  CopyToClipboard: 'copyToClipboard',
  WalletBalanceVisibility: 'walletBalanceVisibility',
  Refill: 'refill',
  RefillWithExternalWallet: 'refillWithExternalWallet',
};

export const actionIcons = {
  Eye: {
    iconValue: 'eye',
  },
  EyeSlash: {
    iconValue: 'eye.slash',
  },
  Clipboard: {
    iconValue: 'doc.on.doc',
  },
  Refill: {
    iconValue: 'goforward.plus',
  },
  RefillWithExternalWallet: {
    iconValue: 'qrcode',
  },
};

export default TransactionsNavigationHeader;
