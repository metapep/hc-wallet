import assert from 'assert';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import {
  SyncRequest,
  TransactionSyncCoordinator,
  TransactionSyncCoordinatorDependencies,
  WalletPageCursor,
} from '../../class/transaction-sync-coordinator';
import { Transaction, TWallet } from '../../class/wallets/types';

type MockWallet = Pick<TWallet, 'chain' | 'getID' | 'getTransactions' | 'getPreferredBalanceUnit'>;

const makeTx = (txid: string, timestamp: number, confirmations = 1, value = 1000): Transaction => ({
  txid,
  hash: txid,
  version: 1,
  size: 200,
  vsize: 140,
  weight: 560,
  locktime: 0,
  inputs: [],
  outputs: [],
  blockhash: '',
  confirmations,
  time: timestamp,
  blocktime: timestamp,
  timestamp,
  value,
});

const makeWallet = (id: string, txs: Transaction[]): MockWallet => ({
  chain: Chain.ONCHAIN,
  getID: () => id,
  getTransactions: () => txs,
  getPreferredBalanceUnit: () => BitcoinUnit.BTC,
});

const createCoordinator = (
  walletsRef: { current: MockWallet[] },
  performSync: (request: SyncRequest) => Promise<void> = async () => {},
): TransactionSyncCoordinator => {
  const dependencies: TransactionSyncCoordinatorDependencies = {
    getWallets: () => walletsRef.current as unknown as TWallet[],
    performSync,
    loadSnapshot: async () => null,
    saveSnapshot: async () => undefined,
  };

  return new TransactionSyncCoordinator(dependencies);
};

describe('TransactionSyncCoordinator', () => {
  it('builds a unified home feed with top 10 per wallet and deterministic ordering', () => {
    const walletATxs = Array.from({ length: 12 }, (_v, index) => makeTx(`A-${index}`, 200 - index));
    const walletBTxs = Array.from({ length: 12 }, (_v, index) => makeTx(`B-${index}`, 300 - index));

    const walletsRef = {
      current: [makeWallet('wallet-a', walletATxs), makeWallet('wallet-b', walletBTxs)],
    };

    const coordinator = createCoordinator(walletsRef);
    coordinator.hydrateFromWallets(walletsRef.current as unknown as TWallet[]);

    const homeFeed = coordinator.getHomeFeed();
    assert.strictEqual(homeFeed.length, 20);

    const countsByWallet = homeFeed.reduce<Record<string, number>>((acc, row) => {
      acc[row.walletID] = (acc[row.walletID] ?? 0) + 1;
      return acc;
    }, {});

    assert.strictEqual(countsByWallet['wallet-a'], 10);
    assert.strictEqual(countsByWallet['wallet-b'], 10);

    for (let i = 1; i < homeFeed.length; i++) {
      assert.ok(homeFeed[i - 1].timestamp >= homeFeed[i].timestamp);
    }

    assert.strictEqual(homeFeed[0].txid, 'B-0');
  });

  it('supports stable pagination by frozen revision with no gaps or duplicates', () => {
    const walletTxs = Array.from({ length: 60 }, (_v, index) => makeTx(`TX-${index}`, 1000 - index));
    const wallet = makeWallet('wallet-1', walletTxs);
    const walletsRef = { current: [wallet] };

    const coordinator = createCoordinator(walletsRef);
    coordinator.hydrateFromWallets(walletsRef.current as unknown as TWallet[]);

    const firstPage = coordinator.getWalletPage('wallet-1', undefined, 25);
    assert.strictEqual(firstPage.rows.length, 25);
    assert.ok(firstPage.nextCursor);

    const secondPage = coordinator.getWalletPage('wallet-1', firstPage.nextCursor as WalletPageCursor, 25);
    assert.strictEqual(secondPage.rows.length, 25);

    // Simulate a new transaction arriving while the user is paginating.
    walletTxs.unshift(makeTx('TX-new', 2000));
    coordinator.hydrateFromWallets(walletsRef.current as unknown as TWallet[]);

    const frozenSecondPage = coordinator.getWalletPage(
      'wallet-1',
      {
        walletId: 'wallet-1',
        revision: firstPage.revision,
        offset: 25,
      },
      25,
    );

    assert.deepStrictEqual(
      frozenSecondPage.rows.map(row => row.txid),
      secondPage.rows.map(row => row.txid),
    );
  });

  it('coalesces duplicate sync requests and runs one underlying sync call', async () => {
    const walletsRef = {
      current: [makeWallet('wallet-a', [makeTx('A-1', 100)])],
    };

    let performSyncCalls = 0;
    const coordinator = createCoordinator(walletsRef, async () => {
      performSyncCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    await Promise.all([
      coordinator.requestSync({ scope: 'wallet', walletIds: ['wallet-a'], reason: 'focus', priority: 'high' }),
      coordinator.requestSync({ scope: 'wallet', walletIds: ['wallet-a'], reason: 'pull', priority: 'high' }),
    ]);

    assert.strictEqual(performSyncCalls, 1);
  });
});
