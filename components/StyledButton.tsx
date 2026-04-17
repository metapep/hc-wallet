import React, { FC } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from './themes';

export const StyledButtonType: Record<string, string> = { default: 'default', destroy: 'destroy', grey: 'grey' };

interface StyledButtonProps {
  onPress: () => void;
  text: string;
  disabled?: boolean;
  buttonStyle?: keyof typeof StyledButtonType;
}

const StyledButton: FC<StyledButtonProps> = ({ onPress, text, disabled = false, buttonStyle = StyledButtonType.default }) => {
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    buttonDefault: {
      backgroundColor: colors.accentInfoBackground,
    },
    buttonDestroy: {
      backgroundColor: colors.accentErrorBackground,
    },
    buttonGrey: {
      backgroundColor: colors.lightButton,
    },
    textDefault: {
      color: colors.accentInfoText,
    },
    textDestroy: {
      color: colors.accentErrorText,
    },
    textGray: {
      color: colors.buttonTextColor,
    },
    container: {
      opacity: disabled ? 0.5 : 1.0,
    },
  });
  const textStyles = () => {
    if (buttonStyle === StyledButtonType.grey) {
      return stylesHook.textGray;
    } else if (buttonStyle === StyledButtonType.destroy) {
      return stylesHook.textDestroy;
    } else {
      return stylesHook.textDefault;
    }
  };

  const buttonStyles = () => {
    if (buttonStyle === StyledButtonType.grey) {
      return stylesHook.buttonGrey;
    } else if (buttonStyle === StyledButtonType.destroy) {
      return stylesHook.buttonDestroy;
    } else {
      return stylesHook.buttonDefault;
    }
  };

  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled} style={stylesHook.container}>
      <View style={[styles.buttonContainer, buttonStyles()]}>
        <Text style={[styles.text, textStyles()]}>{text}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  buttonContainer: {
    borderRadius: 9,
    minHeight: 49,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    alignSelf: 'auto',
    flexGrow: 1,
    marginHorizontal: 4,
  },
  text: {
    fontWeight: '600',
    fontSize: 15,
  },
});

export default StyledButton;
