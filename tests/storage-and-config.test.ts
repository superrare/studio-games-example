import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStorage } from '../src/account-storage.js';
import { parseConfiguration } from '../src/config.js';
import { Credits } from '../src/credits.js';

const appId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const valid = { appId, groupId, studioUrl: 'https://studio.superrare.com', apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com', appOrigin: 'https://game.example.com', display: 'popup', game: 'target-rush' };

test('SDK session restoration is global but game auth and pending consent isolate canonical wallets', () => {
  const values = new Map<string, string>();
  const backing = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let address: string | undefined;
  const storage = accountStorage(backing, () => address);
  storage.setItem('superrare.connect.session', 'Connect credentials');
  assert.equal(storage.getItem('superrare.connect.session'), 'Connect credentials');
  address = '0xAAAA';
  storage.setItem('superrare.connect.game-authorization:scope', 'wallet A auth');
  storage.setItem('superrare.connect.game-attempt:scope:original-key', 'wallet A consent');
  address = '0xBBBB';
  assert.equal(storage.getItem('superrare.connect.game-authorization:scope'), null);
  assert.equal(storage.getItem('superrare.connect.game-attempt:scope:original-key'), null);
  assert.equal(storage.getItem('superrare.connect.session'), 'Connect credentials');
  storage.setItem('superrare.connect.game-authorization:scope', 'wallet B auth');
  address = undefined;
  storage.removeItem('superrare.connect.game-authorization:scope');
  address = '0xaaaa';
  assert.equal(storage.getItem('superrare.connect.game-authorization:scope'), 'wallet A auth');
  assert.equal(storage.getItem('superrare.connect.game-attempt:scope:original-key'), 'wallet A consent');
  address = '0xbbbb';
  assert.equal(storage.getItem('superrare.connect.game-authorization:scope'), 'wallet B auth');
});

test('configuration accepts embedded and popup Connect and rejects invalid origins and public secrets', () => {
  assert.deepEqual(parseConfiguration(valid, valid.appOrigin), valid);
  assert.equal(parseConfiguration({ ...valid, display: 'embed' }, valid.appOrigin).display, 'embed');
  assert.equal(parseConfiguration({ ...valid, display: 'popup' }, valid.appOrigin).display, 'popup');
  assert.equal(parseConfiguration(Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'display')), valid.appOrigin).display, 'embed');
  assert.throws(() => parseConfiguration({ ...valid, appId: 'REPLACE_WITH_UUID' }));
  assert.throws(() => parseConfiguration({ ...valid, appOrigin: 'https://game.example.invalid' }));
  assert.throws(() => parseConfiguration({ ...valid, display: 'frame' }));
  assert.throws(() => parseConfiguration({ ...valid, apiUrl: 'http://api.superrare.com' }));
  assert.throws(() => parseConfiguration({ ...valid, appSecret: 'must-not-be-public' }));
  assert.throws(() => parseConfiguration(valid, 'https://unapproved.example.com'));
  assert.equal(parseConfiguration(valid, 'http://127.0.0.1:4173').appOrigin, valid.appOrigin);
});

test('leaderboard windows reject partial, malformed and ambiguous configuration instead of falling back to all-time', () => {
  for (const leaderboardWindow of [
    null,
    { from: '2026-10-19T00:00:00Z' },
    { to: '2026-10-26T00:00:00Z' },
    { from: '2026-10-19T00:00:00', to: '2026-10-26T00:00:00Z' },
    { from: '2026-02-29T00:00:00Z', to: '2026-03-02T00:00:00Z' },
    { from: '2026-10-19T00:00:00Z', to: '2026-10-26T00:00:00Z', reset: true },
  ]) {
    assert.throws(() => parseConfiguration({ ...valid, leaderboardWindow }));
  }
});

test('unreadable purchase evidence blocks replacement quotes without deleting the stored record', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const evidence = '{broken payment evidence';
  let quoteRequests = 0;
  const state = {
    recoveryBlocked: false,
    busy: false,
    _stateKey: () => 'saved-purchase',
    _legacyStateKey: () => 'legacy-purchase',
    _legacyMigrationKey: () => 'legacy-purchase:migrated-v2',
    _authorization: () => ({ address: '0x1111111111111111111111111111111111111111' }),
    _renderActions: () => {},
    _say: () => {},
    game: { credits: { createPurchase: async () => { quoteRequests += 1; throw new Error('Unexpected replacement quote'); } } },
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => evidence } });
    Reflect.apply(Credits.prototype._loadRecord, state, ['wallet']);
    await Reflect.apply(Credits.prototype._createQuote, state, []);
    assert.equal(state.recoveryBlocked, true);
    assert.equal(quoteRequests, 0);
    assert.equal(localStorage.getItem('saved-purchase'), evidence);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
    Reflect.apply(Credits.prototype._loadRecord, state, ['wallet']);
    assert.equal(state.recoveryBlocked, false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('legacy USDC purchase recovery migrates losslessly and cannot be resurrected after cancellation', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const backing = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const legacyKey = 'purchase:v1:0xwallet';
  const currentKey = 'purchase:v2:0xwallet';
  const markerKey = `${legacyKey}:migrated-v2`;
  const evidence = {
    purchase: {
      id: 'purchase-1', accountId: 'account-1', paymentConfigId: 'config-1', chainId: 1,
      address: '0xwallet', treasuryAddress: '0xtreasury', usdcAddress: '0xtoken',
      packPriceAtomic: '10000', packCredits: 10, minBlock: '123', createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-01T00:30:00Z', transactionHash: '0xtransaction', creditedAt: null,
      opaqueEvidence: { retained: true },
    },
    confirmPayment: false, outcomeUnknown: true, intentId: 'intent-1', intentStatus: 'pending',
    transactionHash: '0xtransaction', credited: false,
  };
  values.set(legacyKey, JSON.stringify(evidence));
  const state = {
    storageKey: 'purchase', recoveryBlocked: false,
    _stateKey: (address: string) => `purchase:v2:${address}`,
    _legacyStateKey: (address: string) => `purchase:v1:${address}`,
    _legacyMigrationKey: (address: string) => `purchase:v1:${address}:migrated-v2`,
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: backing });
    const migrated = Reflect.apply(Credits.prototype._loadRecord, state, ['0xwallet']);
    const { usdcAddress, ...legacyPurchase } = evidence.purchase;
    assert.deepEqual(migrated, {
      ...evidence,
      purchase: {
        ...legacyPurchase,
        currency: 'USDC',
        tokenAddress: usdcAddress,
      },
    });
    assert.equal(values.has(legacyKey), true);
    assert.equal(values.get(markerKey), '1');
    values.delete(currentKey);
    assert.equal(Reflect.apply(Credits.prototype._loadRecord, state, ['0xwallet']), undefined);
    assert.equal(values.has(legacyKey), true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
