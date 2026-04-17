import Clipboard from '@react-native-clipboard/clipboard';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../blue_modules/hapticFeedback';
import loc from '../loc';
import { useTheme } from './themes';

type CopyToClipboardButtonProps = {
  stringToCopy: string;
  displayText?: string;
};

export const CopyToClipboardButton: React.FC<CopyToClipboardButtonProps> = ({ stringToCopy, displayText }) => {
  const { colors } = useTheme();
  const onPress = () => {
    Clipboard.setString(stringToCopy);
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
  };

  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress}>
      <Text style={[styles.text, { color: colors.accentInfoText }]}>{displayText && displayText.length > 0 ? displayText : loc.transactions.details_copy}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  text: { fontSize: 16, fontWeight: '400' },
});

export default CopyToClipboardButton;
