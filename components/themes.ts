import { DarkTheme, DefaultTheme, useTheme as useThemeBase } from '@react-navigation/native';
import { Appearance } from 'react-native';

export const BlueDefaultTheme = {
  ...DefaultTheme,
  closeImage: require('../img/close.png'),
  barStyle: 'dark-content',
  scanImage: require('../img/scan-white.png'),
  colors: {
    ...DefaultTheme.colors,
    borderWidth: 0.5,
    brandingColor: '#ffffff',
    customHeader: '#ffffff',
    foregroundColor: '#111317',
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
    buttonBackgroundColor: '#D9DEE7',
    buttonTextColor: '#111317',
    secondButtonTextColor: '#5F6672',
    buttonAlternativeTextColor: '#111317',
    buttonDisabledBackgroundColor: '#D9DEE7',
    buttonDisabledTextColor: '#A0A6B2',
    inputBorderColor: '#D9DEE7',
    inputBackgroundColor: '#FFFFFF',
    alternativeTextColor: '#5F6672',
    alternativeTextColor2: '#055B69',
    buttonBlueBackgroundColor: '#CBD1DB',
    buttonGrayBackgroundColor: '#E6E8EE',
    incomingBackgroundColor: '#D5F9E0',
    incomingForegroundColor: '#055B69',
    outgoingBackgroundColor: '#FFE3E3',
    outgoingForegroundColor: '#C60001',
    successColor: '#47E86A',
    failedColor: '#C60001',
    placeholderTextColor: '#5F6672',
    shadowColor: '#000000',
    inverseForegroundColor: '#ffffff',
    hdborderColor: '#055B69',
    hdbackgroundColor: '#E7F3F5',
    lnborderColor: '#055B69',
    lnbackgroundColor: '#E7F3F5',
    background: '#F7F8FA',
    lightButton: '#FFFFFF',
    ballReceive: '#D5F9E0',
    ballOutgoing: '#FFE3E3',
    lightBorder: '#D9DEE7',
    ballOutgoingExpired: '#E6E8EE',
    modal: '#ffffff',
    formBorder: '#D9DEE7',
    modalButton: '#CBD1DB',
    darkGray: '#5F6672',
    scanLabel: '#5F6672',
    feeText: '#5F6672',
    feeLabel: '#D5F9E0',
    feeValue: '#055B69',
    feeActive: '#D5F9E0',
    labelText: '#5F6672',
    cta2: '#055B69',
    outputValue: '#111317',
    elevated: '#ffffff',
    mainColor: '#D9DEE7',
    success: '#D5F9E0',
    successCheck: '#055B69',
    msSuccessBG: '#47E86A',
    msSuccessCheck: '#09090B',
    newBlue: '#055B69',
    redBG: '#FFE3E3',
    redText: '#C60001',
    changeBackground: '#E7F3F5',
    changeText: '#055B69',
    receiveBackground: '#D5F9E0',
    receiveText: '#055B69',
    androidRippleColor: '#D9DEE7',
  },
};

export type Theme = typeof BlueDefaultTheme;

export const BlueDarkTheme: Theme = {
  ...DarkTheme,
  closeImage: require('../img/close-white.png'),
  scanImage: require('../img/scan-white.png'),
  barStyle: 'light-content',
  colors: {
    ...BlueDefaultTheme.colors,
    ...DarkTheme.colors,
    customHeader: '#09090B',
    brandingColor: '#09090B',
    borderTopColor: '#2A2E36',
    background: '#09090B',
    foregroundColor: '#F3F4F6',
    buttonDisabledBackgroundColor: '#2A2E36',
    buttonBackgroundColor: '#2A2E36',
    buttonTextColor: '#F3F4F6',
    lightButton: '#141418',
    buttonAlternativeTextColor: '#F3F4F6',
    alternativeTextColor: '#A0A6B2',
    alternativeTextColor2: '#2A93A2',
    ballReceive: '#141418',
    ballOutgoing: '#141418',
    lightBorder: '#2A2E36',
    ballOutgoingExpired: '#141418',
    modal: '#141418',
    formBorder: '#2A2E36',
    inputBackgroundColor: '#141418',
    modalButton: '#2A2E36',
    darkGray: '#A0A6B2',
    feeText: '#A0A6B2',
    feeLabel: 'rgba(71,232,106,.2)',
    feeValue: '#F3F4F6',
    feeActive: 'rgba(71,232,106,.2)',
    cta2: '#F3F4F6',
    outputValue: '#F3F4F6',
    elevated: '#141418',
    mainColor: '#2A2E36',
    success: '#141418',
    successCheck: '#47E86A',
    buttonBlueBackgroundColor: '#2A2E36',
    scanLabel: 'rgba(243,244,246,.4)',
    labelText: '#F3F4F6',
    msSuccessBG: '#47E86A',
    msSuccessCheck: '#09090B',
    newBlue: '#2A93A2',
    redBG: '#3A1A1A',
    redText: '#FF8B8B',
    changeBackground: '#12353D',
    changeText: '#2A93A2',
    receiveBackground: 'rgba(71,232,106,.2)',
    receiveText: '#47E86A',
    androidRippleColor: '#2A2E36',
  },
};

// Casting theme value to get autocompletion
export const useTheme = (): Theme => useThemeBase() as Theme;

export const platformColors = {
  background: BlueDefaultTheme.colors.background,
  card: BlueDefaultTheme.colors.modal ?? BlueDefaultTheme.colors.elevated ?? BlueDefaultTheme.colors.background,
  text: BlueDefaultTheme.colors.foregroundColor,
  secondaryText: BlueDefaultTheme.colors.alternativeTextColor ?? BlueDefaultTheme.colors.darkGray,
  separator: BlueDefaultTheme.colors.lightBorder ?? BlueDefaultTheme.colors.borderTopColor,
  chevron: BlueDefaultTheme.colors.alternativeTextColor ?? BlueDefaultTheme.colors.darkGray,
};

export class BlueCurrentTheme {
  static colors: Theme['colors'];
  static closeImage: Theme['closeImage'];
  static scanImage: Theme['scanImage'];

  static updateColorScheme(): void {
    const isColorSchemeDark = Appearance.getColorScheme() === 'dark';
    BlueCurrentTheme.colors = isColorSchemeDark ? BlueDarkTheme.colors : BlueDefaultTheme.colors;
    BlueCurrentTheme.closeImage = isColorSchemeDark ? BlueDarkTheme.closeImage : BlueDefaultTheme.closeImage;
    BlueCurrentTheme.scanImage = isColorSchemeDark ? BlueDarkTheme.scanImage : BlueDefaultTheme.scanImage;
    const colors = BlueCurrentTheme.colors;
    platformColors.background = colors.background;
    platformColors.card = colors.modal ?? colors.elevated ?? colors.background;
    platformColors.text = colors.foregroundColor;
    platformColors.secondaryText = colors.alternativeTextColor ?? colors.darkGray;
    platformColors.separator = colors.lightBorder ?? colors.borderTopColor;
    platformColors.chevron = colors.alternativeTextColor ?? colors.darkGray;
  }
}

BlueCurrentTheme.updateColorScheme();
