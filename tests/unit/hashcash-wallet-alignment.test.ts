import assert from 'assert';

import {
  HDLegacyP2PKHWallet,
  HDSegwitBech32Wallet,
  HDSegwitP2SHWallet,
  HDTaprootWallet,
  SegwitBech32Wallet,
  WatchOnlyWallet,
} from '../../class';
import startImport from '../../class/wallet-import';
import {
  HASHCASH_ADDRESS_PREFIX,
  HASHCASH_TESTNET_BIP44_DERIVATION_PATH,
  HASHCASH_TESTNET_BIP49_DERIVATION_PATH,
  HASHCASH_TESTNET_BIP86_DERIVATION_PATH,
  HASHCASH_TESTNET_DERIVATION_PATH,
} from '../../blue_modules/hashcash';
import type { TWallet } from '../../class/wallets/types';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const createImportStore = () => {
  const wallets: TWallet[] = [];

  return {
    wallets,
    callbacks: [() => undefined, (wallet: TWallet) => wallets.push(wallet), async () => ''] as const,
  };
};

describe('HashCash wallet alignment', () => {
  it('uses HashCash testnet BIP84 for new wallets', () => {
    const wallet = new HDSegwitBech32Wallet();
    wallet.setSecret(MNEMONIC);

    assert.strictEqual(wallet.getDerivationPath(), HASHCASH_TESTNET_DERIVATION_PATH);
    assert.strictEqual(wallet._getDerivationPathByAddress(wallet._getExternalAddressByIndex(0)), "m/84'/1'/0'/0/0");
    assert.ok(wallet._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
  });

  it('uses HashCash testnet coin type for other new HD wallet defaults', () => {
    assert.strictEqual(new HDLegacyP2PKHWallet().getDerivationPath(), HASHCASH_TESTNET_BIP44_DERIVATION_PATH);
    assert.strictEqual(new HDSegwitP2SHWallet().getDerivationPath(), HASHCASH_TESTNET_BIP49_DERIVATION_PATH);
    assert.strictEqual(new HDTaprootWallet().getDerivationPath(), HASHCASH_TESTNET_BIP86_DERIVATION_PATH);
  });

  it('exports a private key that derives to the displayed receive address', () => {
    const hdWallet = new HDSegwitBech32Wallet();
    hdWallet.setSecret(MNEMONIC);

    const singleAddressWallet = new SegwitBech32Wallet();
    const receiveWif = hdWallet._getExternalWIFByIndex(0);
    assert.ok(receiveWif);
    singleAddressWallet.setSecret(receiveWif);

    assert.strictEqual(singleAddressWallet.getAddress(), hdWallet._getExternalAddressByIndex(0));
  });

  it('uses the testnet path when importing BIP39 wallets', async () => {
    const store = createImportStore();
    const { promise } = startImport(MNEMONIC, false, false, true, ...store.callbacks);
    await promise;

    const importedWallet = store.wallets.find(wallet => wallet.type === HDSegwitBech32Wallet.type) as HDSegwitBech32Wallet | undefined;

    assert.ok(importedWallet);
    assert.strictEqual(importedWallet.getDerivationPath(), HASHCASH_TESTNET_DERIVATION_PATH);
    assert.ok(importedWallet._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
  });

  it('keeps bare zpub watch-only imports on the HashCash testnet BIP84 path', () => {
    const wallet = new HDSegwitBech32Wallet();
    wallet.setSecret(MNEMONIC);

    const watchOnlyWallet = new WatchOnlyWallet();
    watchOnlyWallet.setSecret(wallet.getXpub());
    watchOnlyWallet.init();

    assert.strictEqual(watchOnlyWallet.getDerivationPath(), HASHCASH_TESTNET_DERIVATION_PATH);
    assert.ok(watchOnlyWallet._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
  });
});
