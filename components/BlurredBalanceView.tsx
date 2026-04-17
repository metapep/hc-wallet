import React from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from './Icon';
import { useTheme } from './themes';

export const BlurredBalanceView = () => {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <View style={[styles.background, { backgroundColor: colors.backgroundSurfaceSecondary }]} />
      <Icon name="eye-slash" type="font-awesome" color={colors.textPrimary} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
  },
  background: {
    height: 30,
    width: 110,
    marginRight: 8,
    borderRadius: 9,
  },
});
