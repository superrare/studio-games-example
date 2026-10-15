import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStorage } from '../src/account-storage.js';
import { parseConfiguration, scoringConfiguration } from '../src/config.js';
import { Credits } from '../src/credits.js';

const appId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const valid = { appId, groupId, studioUrl: 'https://studio.superrare.com', apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com', appOrigin: 'https://game.example.com', display: 'embed', game: 'flappy-bird' };

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

test('configuration accepts embedded Connect and rejects popup mode, untrusted origins and secrets', () => {
  assert.deepEqual(parseConfiguration(valid, valid.appOrigin), valid);
  assert.throws(() => parseConfiguration({ ...valid, appId: 'REPLACE_WITH_UUID' }));
  assert.throws(() => parseConfiguration({ ...valid, appOrigin: 'https://game.example.invalid' }));
  assert.throws(() => parseConfiguration({ ...valid, display: 'popup' }));
  assert.throws(() => parseConfiguration({ ...valid, apiUrl: 'http://api.superrare.com' }));
  assert.throws(() => parseConfiguration({ ...valid, appSecret: 'must-not-be-public' }));
  assert.throws(() => parseConfiguration(valid, 'https://unapproved.example.com'));
  assert.equal(parseConfiguration(valid, 'http://127.0.0.1:4173').appOrigin, valid.appOrigin);
});
test('game variants use bounded matching scoring windows and reject retired variant IDs', () => {
  assert.deepEqual(scoringConfiguration('flappy-bird'), { game: 'flappy-bird', maxTicks: 1400, roundTicks: 1200 });
  assert.deepEqual(scoringConfiguration('platformer'), { game: 'platformer', maxTicks: 2600, roundTicks: 2400 });
  assert.throws(() => parseConfiguration({ ...valid, game: 'target-rush' }));
  assert.throws(() => parseConfiguration({ ...valid, game: 'color-match' }));
});
test('purchase quotes accept exactly 10 credits for 0.10 USDC and reject the previous pack price', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  const quote = (packPriceAtomic: string) => ({
    chainId: 1, packPriceAtomic, packCredits: 10,
    usdcAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', address,
  });
  const makeHarness = (purchase: ReturnType<typeof quote>) => {
    const harness = Object.assign(Object.create(Credits.prototype) as object, {
      recoveryBlocked: false, busy: false, accountAddress: undefined, record: undefined,
      game: { credits: { createPurchase: async () => purchase } },
      _authorization: () => ({ address }),
      _renderActions: () => {},
      _saveRecord: (record: unknown) => { Object.assign(harness, { record }); },
      _say: (message: string) => { Object.assign(harness, { message }); },
    }) as Credits & { message?: string };
    return harness;
  };
  const accepted = makeHarness(quote('100000'));
  await Reflect.apply(Credits.prototype._createQuote, accepted, []);
  assert.equal(accepted.record?.purchase.packPriceAtomic, '100000');
  assert.match(accepted.message ?? '', /10 credits for \$0\.10 USDC/);
  const rejected = makeHarness(quote('10000'));
  await Reflect.apply(Credits.prototype._createQuote, rejected, []);
  assert.equal(rejected.record, undefined);
  assert.match(rejected.message ?? '', /requires \$0\.10 USDC for 10 credits/);
});

test('unreadable purchase evidence blocks replacement quotes without deleting the stored record', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const evidence = '{broken payment evidence';
  let quoteRequests = 0;
  const state = {
    recoveryBlocked: false,
    busy: false,
    _stateKey: () => 'saved-purchase',
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
