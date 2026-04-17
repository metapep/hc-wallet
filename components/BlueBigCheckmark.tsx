import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import Icon from './Icon';
import { useTheme } from './themes';

interface BlueBigCheckmarkProps extends ViewProps {}

export function BlueBigCheckmark(props: BlueBigCheckmarkProps) {
  const { colors } = useTheme();
  const styleHook = StyleSheet.create({
    container: {
      backgroundColor: colors.accentSuccessBackground,
    },
  });
  return (
    <View style={[styles.container, styleHook.container, props.style]}>
      <Icon name="check" size={50} type="font-awesome" color={colors.successCheck} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 0,
  },
});
