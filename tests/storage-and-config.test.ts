import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStorage } from '../src/account-storage.js';
import { parseConfiguration } from '../src/config.js';
import { Credits } from '../src/credits.js';

const appId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const valid = { appId, groupId, studioUrl: 'https://studio.superrare.com', apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com', appOrigin: 'https://game.example.com', display: 'embed', game: 'target-rush' };

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

test('configuration requires embedded Connect and rejects insecure origins and secrets', () => {
  assert.deepEqual(parseConfiguration(valid, valid.appOrigin), valid);
  assert.throws(() => parseConfiguration({ ...valid, appId: 'REPLACE_WITH_UUID' }));
  assert.throws(() => parseConfiguration({ ...valid, appOrigin: 'https://game.example.invalid' }));
  assert.throws(() => parseConfiguration({ ...valid, display: 'popup' }));
  assert.throws(() => parseConfiguration({ ...valid, apiUrl: 'http://api.superrare.com' }));
  assert.throws(() => parseConfiguration({ ...valid, appSecret: 'must-not-be-public' }));
  assert.throws(() => parseConfiguration(valid, 'https://unapproved.example.com'));
  assert.equal(parseConfiguration(valid, 'http://127.0.0.1:4173').appOrigin, valid.appOrigin);
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
