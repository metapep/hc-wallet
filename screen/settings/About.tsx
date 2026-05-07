import Clipboard from '@react-native-clipboard/clipboard';
import React, { useCallback } from 'react';
import { Alert, Image, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getApplicationName, getBuildNumber, getBundleId, getUniqueIdSync, getVersion, hasGmsSync } from 'react-native-device-info';

import A from '../../blue_modules/analytics';
import { BlueTextCentered } from '../../BlueComponents';
import { HDSegwitBech32Wallet } from '../../class';
import presentAlert from '../../components/Alert';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import Button from '../../components/Button';
import {
  SettingsCard,
  SettingsFlatList,
  SettingsListItem,
  SettingsListItemProps,
  SettingsSection,
  SettingsSectionHeader,
} from '../../components/platform';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc, { formatStringAddTwoWhiteSpaces } from '../../loc';

const branch = require('../../current-branch.json');

interface AboutItem extends SettingsListItemProps {
  id: string;
  section?: number;
  customContent?: React.ReactNode;
}

const About: React.FC = () => {
  const { navigate } = useExtendedNavigation();
  const { isElectrumDisabled } = useSettings();
  const { colors, dark } = useTheme();
  const aboutLogoSource = dark ? require('../../img/logo-word-dark.png') : require('../../img/logo-word-light.png');

  const handleOnReleaseNotesPress = useCallback(() => {
    navigate('ReleaseNotes');
  }, [navigate]);

  const handleOnSelfTestPress = useCallback(() => {
    if (isElectrumDisabled) {
      presentAlert({ message: loc.settings.about_selftest_electrum_disabled });
    } else {
      navigate('SelfTest');
    }
  }, [isElectrumDisabled, navigate]);

  const handleOnLicensingPress = useCallback(() => {
    navigate('Licensing');
  }, [navigate]);

  const handleOnWebsitePress = useCallback(() => {
    Linking.openURL('https://hashcash.network');
  }, []);

  const handleOnSupportPress = useCallback(() => {
    Linking.openURL('mailto:support@hashcash.network');
  }, []);

  const handleOnPrivacyPress = useCallback(() => {
    Linking.openURL('https://hashcash.network/privacy');
  }, []);

  const handleOnTermsPress = useCallback(() => {
    Linking.openURL('https://hashcash.network/terms');
  }, []);

  const handleOnRatePress = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('https://hashcash.network');
      } else {
        await Linking.openURL('https://hashcash.network');
      }
    } catch (error: any) {
      console.error('Rate app failed:', error.message);
    }
  }, []);

  const handlePerformanceTest = useCallback(async () => {
    const secret = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const w = new HDSegwitBech32Wallet();
    w.setSecret(secret);

    const start = Date.now();
    let num;
    for (num = 0; num < 10000; num++) {
      w._getExternalAddressByIndex(num);
      if (Date.now() - start > 10 * 1000) {
        break;
      }
    }

    Alert.alert(loc.formatString(loc.settings.performance_score, { num }));
  }, []);

  const aboutItems = useCallback((): AboutItem[] => {
    const items: AboutItem[] = [
      {
        id: 'header',
        title: '',
        customContent: (
          <SettingsSection compact>
            <SettingsCard style={[styles.card, styles.headerCard]}>
              <View style={styles.center}>
                <Image style={styles.logo} source={aboutLogoSource} />
                <Text style={[styles.textFree, { color: colors.foregroundColor }]}>{loc.settings.about_free}</Text>
                <Text style={[styles.textBackup, { color: colors.alternativeTextColor }]}>
                  {formatStringAddTwoWhiteSpaces(loc.settings.about_backup)}
                </Text>
                {((Platform.OS === 'android' && hasGmsSync()) || Platform.OS !== 'android') && (
                  <View style={styles.headerButton}>
                    <Button onPress={handleOnRatePress} title={loc.settings.about_review} />
                  </View>
                )}
              </View>
            </SettingsCard>
          </SettingsSection>
        ),
        section: 1,
      },
      {
        id: 'website',
        title: 'hashcash.network',
        iconName: 'network',
        onPress: handleOnWebsitePress,
        section: 2,
      },
      {
        id: 'support',
        title: 'support@hashcash.network',
        iconName: 'about',
        onPress: handleOnSupportPress,
        section: 2,
      },
      {
        id: 'privacy',
        title: 'Privacy Policy',
        iconName: 'licensing',
        onPress: handleOnPrivacyPress,
        section: 2,
      },
      {
        id: 'terms',
        title: 'Terms of Service',
        iconName: 'releaseNotes',
        onPress: handleOnTermsPress,
        section: 2,
      },
      {
        id: 'builtWith',
        title: '',
        customContent: (
          <SettingsSection compact>
            <SettingsCard style={[styles.card, styles.builtWithCard]}>
              <BlueTextCentered>{loc.settings.about_awesome}</BlueTextCentered>
              <BlueSpacing20 />
              <BlueTextCentered>React Native</BlueTextCentered>
              <BlueTextCentered>Core transaction library</BlueTextCentered>
              <BlueTextCentered>Electrum server</BlueTextCentered>
            </SettingsCard>
          </SettingsSection>
        ),
        section: 2.5,
      },
      {
        id: 'sectionSpacing1',
        title: '',
        customContent: <View style={styles.sectionSpacing} />,
        section: 2.9,
      },
      {
        id: 'releaseNotes',
        title: loc.settings.about_release_notes,
        iconName: 'releaseNotes',
        chevron: true,
        onPress: handleOnReleaseNotesPress,
        section: 3,
      },
      {
        id: 'licensing',
        title: loc.settings.about_license,
        iconName: 'licensing',
        chevron: true,
        onPress: handleOnLicensingPress,
        section: 3,
      },
      {
        id: 'selfTest',
        title: loc.settings.about_selftest,
        iconName: 'selfTest',
        chevron: true,
        onPress: handleOnSelfTestPress,
        testID: 'RunSelfTestButton',
        section: 3,
      },
      {
        id: 'performanceTest',
        title: loc.settings.run_performance_test,
        iconName: 'performance',
        chevron: true,
        onPress: handlePerformanceTest,
        section: 3,
      },
      {
        id: 'footer',
        title: '',
        customContent: (
          <View style={styles.footerContainer}>
            <BlueSpacing20 />
            <Text style={[styles.footerText, { color: colors.alternativeTextColor }]}>
              {getApplicationName()} ver {getVersion()} (build {getBuildNumber() + ' ' + branch})
            </Text>
            <Text style={[styles.footerText, { color: colors.alternativeTextColor }]}>
              {new Date(Number(getBuildNumber()) * 1000).toUTCString()}
            </Text>
            <Text style={[styles.footerText, { color: colors.alternativeTextColor }]}>{getBundleId()}</Text>
            <Text style={[styles.footerText, { color: colors.alternativeTextColor }]}>Unique ID: {getUniqueIdSync()}</Text>
            <View style={styles.copyToClipboard}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  const stringToCopy = 'userId:' + getUniqueIdSync();
                  A.logError('copied unique id');
                  Clipboard.setString(stringToCopy);
                }}
              >
                <Text style={[styles.copyToClipboardText, { color: colors.foregroundColor }]}>{loc.transactions.details_copy}</Text>
              </TouchableOpacity>
            </View>
            <BlueSpacing20 />
          </View>
        ),
        section: 4,
      },
    ];
    return items;
  }, [
    colors.foregroundColor,
    colors.alternativeTextColor,
    handleOnRatePress,
    handleOnWebsitePress,
    handleOnSupportPress,
    handleOnPrivacyPress,
    handleOnTermsPress,
    handleOnReleaseNotesPress,
    handleOnLicensingPress,
    handleOnSelfTestPress,
    handlePerformanceTest,
    aboutLogoSource,
  ]);

  const renderItem = useCallback(
    (props: { item: AboutItem }) => {
      const { id, section, customContent, ...listItemProps } = props.item;

      if (customContent) {
        return <>{customContent}</>;
      }

      if (listItemProps.title && !listItemProps.leftIcon && !listItemProps.onPress && section) {
        return <SettingsSectionHeader title={listItemProps.title} />;
      }

      const currentSection = Math.floor(section || 0);
      const sectionItems = aboutItems().filter(
        i => Math.floor(i.section || 0) === currentSection && !i.customContent && (i.onPress || i.leftIcon || i.chevron || i.subtitle),
      );
      const indexInSection = sectionItems.findIndex(i => i.id === id);
      const isFirstInSection = indexInSection === 0;
      const isLastInSection = indexInSection === sectionItems.length - 1;
      const position = isFirstInSection && isLastInSection ? 'single' : isFirstInSection ? 'first' : isLastInSection ? 'last' : 'middle';

      return <SettingsListItem {...listItemProps} position={position} />;
    },
    [aboutItems],
  );

  const keyExtractor = useCallback((item: AboutItem, index: number) => `${item.id}-${index}`, []);

  const ListFooterComponent = useCallback(() => <View style={styles.sectionSpacing} />, []);

  return (
    <SettingsFlatList
      data={aboutItems()}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      testID="AboutScrollView"
      ListFooterComponent={ListFooterComponent}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustContentInsets
      removeClippedSubviews
    />
  );
};

export default About;

const styles = StyleSheet.create({
  sectionSpacing: {
    height: 16,
  },
  headerCard: {
    backgroundColor: 'transparent',
    ...(Platform.OS === 'android' && {
      borderRadius: 0,
      elevation: 0,
      marginHorizontal: 0,
      marginVertical: 0,
    }),
  },
  card: {
    marginVertical: 8,
  },
  builtWithCard: {
    paddingVertical: 16,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 240,
    height: 48,
    marginBottom: 12,
    resizeMode: 'contain',
  },
  textFree: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
  textBackup: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  headerButton: {
    marginTop: 16,
  },
  footerContainer: {
    marginTop: 16,
  },
  footerText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 4,
  },
  copyToClipboard: {
    marginTop: 8,
    alignItems: 'center',
  },
  copyToClipboardText: {
    fontSize: 12,
  },
});
