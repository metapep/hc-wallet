import { HDAezeedWallet } from './wallets/hd-aezeed-wallet';
import { HDLegacyBreadwalletWallet } from './wallets/hd-legacy-breadwallet-wallet';
import { HDLegacyElectrumSeedP2PKHWallet } from './wallets/hd-legacy-electrum-seed-p2pkh-wallet';
import { HDLegacyP2PKHWallet } from './wallets/hd-legacy-p2pkh-wallet';
import { HDSegwitBech32Wallet } from './wallets/hd-segwit-bech32-wallet';
import { HDSegwitElectrumSeedP2WPKHWallet } from './wallets/hd-segwit-electrum-seed-p2wpkh-wallet';
import { HDSegwitP2SHWallet } from './wallets/hd-segwit-p2sh-wallet';
import { LegacyWallet } from './wallets/legacy-wallet';
import { LightningCustodianWallet } from './wallets/lightning-custodian-wallet'; // Missing import
import { MultisigHDWallet } from './wallets/multisig-hd-wallet';
import { SegwitBech32Wallet } from './wallets/segwit-bech32-wallet';
import { SLIP39LegacyP2PKHWallet, SLIP39SegwitBech32Wallet, SLIP39SegwitP2SHWallet } from './wallets/slip39-wallets';
import { WatchOnlyWallet } from './wallets/watch-only-wallet';
import { TaprootWallet } from './wallets/taproot-wallet.ts';
import { LightningArkWallet } from './wallets/lightning-ark-wallet.ts';
import { BlueCurrentTheme } from '../components/themes';

export default class WalletGradient {
  private static get paletteStart(): string {
    return BlueCurrentTheme.colors.backgroundSurface;
  }

  private static get paletteMiddle(): string {
    return BlueCurrentTheme.colors.backgroundSurfaceSecondary;
  }

  private static get paletteEnd(): string {
    return BlueCurrentTheme.colors.backgroundPrimary;
  }

  private static get walletGradient(): string[] {
    return [WalletGradient.paletteStart, WalletGradient.paletteEnd];
  }

  private static get multisigGradient(): string[] {
    return [WalletGradient.paletteStart, WalletGradient.paletteMiddle, WalletGradient.paletteEnd];
  }

  static createWallet = () => {
    return WalletGradient.paletteStart;
  };

  static gradientsFor(type: string): string[] {
    let gradient: string[];
    switch (type) {
      case WatchOnlyWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case LegacyWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case TaprootWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case HDLegacyP2PKHWallet.type:
      case HDLegacyElectrumSeedP2PKHWallet.type:
      case SLIP39LegacyP2PKHWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case HDLegacyBreadwalletWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case HDSegwitP2SHWallet.type:
      case SLIP39SegwitP2SHWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case HDSegwitBech32Wallet.type:
      case HDSegwitElectrumSeedP2WPKHWallet.type:
      case SLIP39SegwitBech32Wallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case SegwitBech32Wallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case MultisigHDWallet.type:
        gradient = WalletGradient.multisigGradient;
        break;
      case HDAezeedWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      case LightningArkWallet.type:
      case LightningCustodianWallet.type:
        gradient = WalletGradient.walletGradient;
        break;
      default:
        gradient = WalletGradient.walletGradient;
        break;
    }
    return gradient;
  }

  static headerColorFor(type: string): string {
    return WalletGradient.gradientsFor(type)[0];
  }
}
