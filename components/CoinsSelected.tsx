import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Avatar from './Avatar';

import loc from '../loc';
import { useTheme } from './themes';

const styles = StyleSheet.create({
  root: {
    height: 48,
    borderRadius: 8,
    flexDirection: 'row',
  },
  labelContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingLeft: 16,
  },
  labelText: {
    fontWeight: 'bold',
  },
  buttonContainer: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ball: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
});

interface CoinsSelectedProps {
  number: number;
  onContainerPress: () => void;
  onClose: () => void;
}

const CoinsSelected: React.FC<CoinsSelectedProps> = ({ number, onContainerPress, onClose }) => {
  const { colors } = useTheme();

  return (
    <TouchableOpacity accessibilityRole="button" style={[styles.root, { backgroundColor: colors.accentPrimary }]} onPress={onContainerPress}>
      <View style={styles.labelContainer}>
        <Text style={[styles.labelText, { color: colors.backgroundSurface }]}>{loc.formatString(loc.cc.coins_selected, { number })}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" style={styles.buttonContainer} onPress={onClose}>
        <Avatar
          rounded
          size={26}
          containerStyle={[styles.ball, { backgroundColor: colors.backgroundSurfaceSecondary }]}
          icon={{ name: 'close', size: 22, type: 'ionicons', color: colors.foregroundColor }}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

export default CoinsSelected;
