import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from './Icon';
import loc from '../loc';
import { useTheme } from './themes';

interface Props {
  handleDismiss: () => void;
}

const WatchOnlyWarning: React.FC<Props> = ({ handleDismiss }) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.accentInfoBackground }]}> 
      <View style={styles.content}>
        <TouchableOpacity style={[styles.dismissButton, { backgroundColor: colors.backgroundSurfaceSecondary }]} onPress={handleDismiss}>
          <Icon name="close" color={colors.textPrimary} size={20} />
        </TouchableOpacity>
        <Icon name="warning" color={colors.accentInfoText} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{loc.transactions.watchOnlyWarningTitle}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{loc.transactions.watchOnlyWarningDescription}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    margin: 16,
    borderRadius: 8,
    position: 'relative',
  },
  dismissButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  content: {
    alignItems: 'center',
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 8,
  },
  description: {
    textAlign: 'center',
  },
});

export default WatchOnlyWarning;
