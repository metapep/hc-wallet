import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '../../components/Icon';
import WalletGradient from '../../class/wallet-gradient';
import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { DetailViewStackParamList } from '../DetailViewStackParamList';
import { navigationRef } from '../../NavigationService';
import { RouteProp } from '@react-navigation/native';
import { Theme } from '../../components/themes';

export type WalletTransactionsRouteProps = RouteProp<DetailViewStackParamList, 'WalletTransactions'>;

const getWalletTransactionsOptions = ({
  route,
  theme,
}: {
  route: WalletTransactionsRouteProps;
  theme: Theme;
}): NativeStackNavigationOptions => {
  const { isLoading = false, walletID, walletType } = route.params;

  const onPress = () => {
    navigationRef.navigate('WalletDetails', {
      walletID,
    });
  };
  const headerForeground = theme.colors.foregroundColor;

  const RightButton = (
    <TouchableOpacity accessibilityRole="button" testID="WalletDetails" disabled={isLoading} style={styles.walletDetails} onPress={onPress}>
      <Icon name="more-horiz" type="material" size={22} color={headerForeground} />
    </TouchableOpacity>
  );

  const backgroundColor = WalletGradient.headerColorFor(walletType);

  return {
    title: '',
    headerBackTitleStyle: { fontSize: 0 },
    headerStyle: {
      backgroundColor,
    },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerTintColor: headerForeground,
    statusBarStyle: theme.barStyle === 'light-content' ? 'light' : 'dark',
    headerBackTitle: undefined,
    headerRight: () => RightButton,
  };
};

const styles = StyleSheet.create({
  walletDetails: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});

export default getWalletTransactionsOptions;
