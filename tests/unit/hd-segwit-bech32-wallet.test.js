import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';

import { HDSegwitBech32Wallet } from '../../class';
import { HASHCASH_ADDRESS_PREFIX, HASHCASH_TESTNET_DERIVATION_PATH } from '../../blue_modules/hashcash';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';

describe('Bech32 Segwit HD (BIP84)', () => {
  it('can create', async function () {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret(mnemonic);

    assert.strictEqual(true, hd.validateMnemonic());
    assert.strictEqual(hd.getDerivationPath(), HASHCASH_TESTNET_DERIVATION_PATH);
    assert.ok(hd.getXpub().startsWith('zpub'));

    assert.ok(hd._getExternalWIFByIndex(0));
    assert.ok(hd._getExternalWIFByIndex(1));
    assert.ok(hd._getInternalWIFByIndex(0));
    assert.ok(hd._getExternalWIFByIndex(0) !== hd._getExternalWIFByIndex(1));
    assert.ok(hd._getInternalWIFByIndex(0) !== hd._getInternalWIFByIndex(1));

    assert.ok(hd._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getExternalAddressByIndex(1).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getInternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getExternalAddressByIndex(0) !== hd._getExternalAddressByIndex(1));
    assert.ok(hd._getInternalAddressByIndex(0) !== hd._getInternalAddressByIndex(1));

    assert.ok(hd.getAllExternalAddresses().includes(hd._getExternalAddressByIndex(0)));
    assert.ok(hd.getAllExternalAddresses().includes(hd._getExternalAddressByIndex(1)));
    assert.ok(!hd.getAllExternalAddresses().includes(hd._getInternalAddressByIndex(0))); // not internal

    assert.ok(hd.addressIsChange(hd._getInternalAddressByIndex(0)));
    assert.ok(!hd.addressIsChange(hd._getExternalAddressByIndex(0)));

    assert.strictEqual(uint8ArrayToHex(hd._getPubkeyByAddress(hd._getExternalAddressByIndex(0))).length, 66);
    assert.strictEqual(uint8ArrayToHex(hd._getPubkeyByAddress(hd._getInternalAddressByIndex(0))).length, 66);

    assert.strictEqual(hd._getDerivationPathByAddress(hd._getExternalAddressByIndex(0)), `${HASHCASH_TESTNET_DERIVATION_PATH}/0/0`);
    assert.strictEqual(hd._getDerivationPathByAddress(hd._getExternalAddressByIndex(1)), `${HASHCASH_TESTNET_DERIVATION_PATH}/0/1`);
    assert.strictEqual(hd._getDerivationPathByAddress(hd._getInternalAddressByIndex(0)), `${HASHCASH_TESTNET_DERIVATION_PATH}/1/0`);
    assert.strictEqual(hd._getDerivationPathByAddress(hd._getInternalAddressByIndex(1)), `${HASHCASH_TESTNET_DERIVATION_PATH}/1/1`);

    assert.strictEqual(hd.getMasterFingerprintHex(), '73C5DA0A');
  });

  it('can generate addresses only via zpub', function () {
    const zpub = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    const hd = new HDSegwitBech32Wallet();
    hd._xpub = zpub;
    assert.ok(hd._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getExternalAddressByIndex(1).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getInternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getExternalAddressByIndex(0) !== hd._getExternalAddressByIndex(1));
    assert.ok(hd._getInternalAddressByIndex(0) !== hd._getInternalAddressByIndex(1));

    assert.ok(hd.getAllExternalAddresses().includes(hd._getExternalAddressByIndex(0)));
    assert.ok(hd.getAllExternalAddresses().includes(hd._getExternalAddressByIndex(1)));
    assert.ok(!hd.getAllExternalAddresses().includes(hd._getInternalAddressByIndex(0))); // not internal
  });

  it('can generate', async () => {
    const hd = new HDSegwitBech32Wallet();
    const hashmap = {};
    for (let c = 0; c < 1000; c++) {
      await hd.generate();
      const secret = hd.getSecret();
      assert.strictEqual(secret.split(' ').length, 12);
      if (hashmap[secret]) {
        throw new Error('Duplicate secret generated!');
      }
      hashmap[secret] = 1;
      assert.ok(secret.split(' ').length === 12 || secret.split(' ').length === 24);
    }

    const hd2 = new HDSegwitBech32Wallet();
    hd2.setSecret(hd.getSecret());
    assert.ok(hd2.validateMnemonic());
  });

  it('can coin control', async () => {
    const hd = new HDSegwitBech32Wallet();

    // fake UTXO so we don't need to use fetchUtxo
    hd._utxo = [
      { txid: '11111', vout: 0, value: 11111 },
      { txid: '22222', vout: 0, value: 22222 },
    ];

    assert.ok(hd.getUtxo().length === 2);

    // freeze one UTXO and set a memo on it
    hd.setUTXOMetadata('11111', 0, { memo: 'somememo', frozen: true });
    assert.strictEqual(hd.getUTXOMetadata('11111', 0).memo, 'somememo');
    assert.strictEqual(hd.getUTXOMetadata('11111', 0).frozen, true);

    // now .getUtxo() should return a limited UTXO set
    assert.ok(hd.getUtxo().length === 1);
    assert.strictEqual(hd.getUtxo()[0].txid, '22222');

    // now .getUtxo(true) should return a full UTXO set
    assert.ok(hd.getUtxo(true).length === 2);

    // for UTXO with no metadata .getUTXOMetadata() should return an empty object
    assert.ok(Object.keys(hd.getUTXOMetadata('22222', 0)).length === 0);
  });

  it('can sign and verify messages', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret(mnemonic);
    let signature;

    // external address
    signature = hd.signMessage('vires is numeris', hd._getExternalAddressByIndex(0));
    assert.strictEqual(hd.verifyMessage('vires is numeris', hd._getExternalAddressByIndex(0), signature), true);

    // internal address
    signature = hd.signMessage('vires is numeris', hd._getInternalAddressByIndex(0));
    assert.strictEqual(hd.verifyMessage('vires is numeris', hd._getInternalAddressByIndex(0), signature), true);

    // multiline message
    signature = hd.signMessage('vires\nis\nnumeris', hd._getExternalAddressByIndex(0));
    assert.strictEqual(hd.verifyMessage('vires\nis\nnumeris', hd._getExternalAddressByIndex(0), signature), true);

    // can't sign if address doesn't belong to wallet
    assert.throws(() => hd.signMessage('vires is numeris', '186FBQmCV5W1xY7ywaWtTZPAQNciVN8Por'));

    // can't verify wrong signature
    assert.throws(() => hd.verifyMessage('vires is numeris', hd._getInternalAddressByIndex(0), 'wrong signature'));

    // Cross-wallet verification should work for HashCash addresses.
    assert.strictEqual(hd.verifyMessage('vires is numeris', hd._getExternalAddressByIndex(0), signature), false);
  });

  it('can use mnemonic with passphrase', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const passphrase = 'super secret passphrase';
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret(mnemonic);
    hd.setPassphrase(passphrase);

    assert.ok(hd.getXpub().startsWith('zpub'));
    assert.ok(hd._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getInternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getExternalWIFByIndex(0));
  });

  it('can create with custom derivation path', async () => {
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    hd.setDerivationPath("m/84'/0'/1'");

    assert.strictEqual(
      hd.getXpub(),
      'zpub6rFR7y4Q2AijF6Gk1bofHLs1d66hKFamhXWdWBup1Em25wfabZqkDqvaieV63fDQFaYmaatCG7jVNUpUiM2hAMo6SAVHcrUpSnHDpNzucB7',
    );

    assert.ok(hd._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getInternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getExternalWIFByIndex(0));

    assert.strictEqual(hd._getDerivationPathByAddress(hd._getExternalAddressByIndex(0)), "m/84'/0'/1'/0/0");
    assert.strictEqual(hd._getDerivationPathByAddress(hd._getInternalAddressByIndex(0)), "m/84'/0'/1'/1/0");
  });

  it('can generate ID', () => {
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const id1 = hd.getID();
    hd.setPassphrase('super secret passphrase');
    const id2 = hd.getID();
    hd.setDerivationPath("m/84'/0'/1'");
    const id3 = hd.getID();

    assert.notStrictEqual(id1, id2);
    assert.notStrictEqual(id2, id3);
    assert.notStrictEqual(id1, id3);
  });

  it('can createTransaction with a correct feerate (with lenghty segwit address)', () => {
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret(process.env.HD_MNEMONIC_BIP84);
    assert.ok(hd.validateMnemonic());

    const utxo = [
      {
        address: 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl',
        vout: 0,
        txid: '8b0ab2c7196312e021e0d3dc73f801693826428782970763df6134457bd2ec20',
        value: 69909,
        wif: '-',
      },
    ];

    const { tx, psbt, outputs } = hd.createTransaction(
      utxo,
      [{ address: 'bc1qtmcfj7lvgjp866w8lytdpap82u7eege58jy52hp4ctk0hsncegyqel8prp', value: 546 }],
      10,
      'bc1qtmcfj7lvgjp866w8lytdpap82u7eege58jy52hp4ctk0hsncegyqel8prp',
    );

    assert.strictEqual(outputs.length, 2);

    const actualFeerate = Number(psbt.getFee()) / tx.virtualSize();
    assert.strictEqual(
      Math.round(actualFeerate) >= 10 && actualFeerate <= 11,
      true,
      `bad feerate, got ${actualFeerate}, expected at least 10; fee: ${psbt.getFee()}; virsualSize: ${tx.virtualSize()} vbytes; ${tx.toHex()}`,
    );
  });

  it('can createTransaction with OP_RETURN', () => {
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret(process.env.HD_MNEMONIC_BIP84);
    assert.ok(hd.validateMnemonic());

    const utxo = [
      {
        address: 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl',
        vout: 0,
        txid: '8b0ab2c7196312e021e0d3dc73f801693826428782970763df6134457bd2ec20',
        value: 69909,
        wif: '-',
      },
    ];

    const { tx, psbt, outputs } = hd.createTransaction(
      utxo,
      [
        { address: hd._getExternalAddressByIndex(0), value: 546 },
        { script: { hex: '00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff' }, value: 0 },
      ],
      150,
      hd._getInternalAddressByIndex(0),
    );

    assert.strictEqual(outputs.length, 3); // destination, op_return, change
    assert.ok(!outputs[1].address); // should not be there as it should be OP_RETURN

    const decodedTx = bitcoin.Transaction.fromHex(tx.toHex());
    // console.log(decodedTx.outs);

    assert.strictEqual(decodedTx.outs[0].value, 546n); // first output - destination
    assert.strictEqual(decodedTx.outs[1].value, 0n); // second output - op_return
    assert.ok(decodedTx.outs[2].value > 0); // third output - change

    assert.strictEqual(uint8ArrayToHex(decodedTx.outs[1].script), '00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff'); // custom script that we are passing

    // console.log(outputs);

    const actualFeerate = Number(psbt.getFee()) / tx.virtualSize();
    assert.strictEqual(
      Math.round(actualFeerate) >= 150 && actualFeerate < 151,
      true,
      `bad feerate, got ${actualFeerate}, expected at least 11; fee: ${psbt.getFee()}; virsualSize: ${tx.virtualSize()} vbytes; ${tx.toHex()}`,
    );
  });

  it('can use french seed', async () => {
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret('abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abeille');

    assert.strictEqual(true, hd.validateMnemonic());
    assert.ok(hd._getExternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
    assert.ok(hd._getInternalAddressByIndex(0).startsWith(HASHCASH_ADDRESS_PREFIX));
  });

  it('can import from standard SeedQR', () => {
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret('008607501025021714880023171503630517020917211425');
    assert.strictEqual(hd.getSecret(), 'approve fruit lens brass ring actual stool coin doll boss strong rate');
    assert.ok(hd.validateMnemonic());

    const hd2 = new HDSegwitBech32Wallet();
    hd2.setSecret('075707570757075700000000043911730136013601360757');
    assert.strictEqual(hd2.getSecret(), 'gadget gadget gadget gadget abandon abandon dad naive baby baby baby gadget');
    assert.ok(hd2.validateMnemonic());

    const hd3 = new HDSegwitBech32Wallet();
    hd3.setSecret('0757075707570757000000000439117301360136013607'); // invalid length
    assert.ok(!hd3.validateMnemonic());

    const hd4 = new HDSegwitBech32Wallet();
    hd4.setSecret('07570757075707abcdef0000043911730136013601360757'); // invalid symbols

    assert.ok(!hd4.validateMnemonic());
  });
});
