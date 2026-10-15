import assert from 'node:assert/strict';
import test from 'node:test';
import { PaidRound } from '../src/round.js';
import { parseSavedRound } from '../src/target-engine.js';

const appId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const address = '0x1111111111111111111111111111111111111111';
const authorization = { appId, groupId, address };
const terms = { credits: 1, title: 'Integration test' };
type PaidRequest = { idempotencyKey: string; fingerprint: string; expectedCredits: number };
type RunRequest = { sessionToken: string; eventId: string; idempotencyKey: string };

class RoundHarness extends PaidRound {
  saved: string[] = [];
  messages: string[] = [];
  save(): void { this.saved.push(JSON.stringify(this.state)); }
  clearActions(): void { /* DOM is irrelevant to protocol assertions. */ }
  announce(message: string): void { this.messages.push(message); }
  showRecoveryError(error: unknown): void { this.messages.push(error instanceof Error ? error.message : String(error)); }
  showRunError(error: unknown): void { this.messages.push(error instanceof Error ? error.message : String(error)); }
}

test('uncertain paid start and server-run retry retain original keys, event, and session after reload', async () => {
  const paid: PaidRequest[] = [];
  const recovered: string[] = [];
  const runs: RunRequest[] = [];
  let round: RoundHarness;
  const game = {
    getAuthorization: () => authorization,
    requestConsent: async (request: PaidRequest) => {
      assert.ok(round.saved.length, 'paid and run keys are saved before consent');
      paid.push(request);
      return { consent: { token: 'test-only-consent' }, recovery: 'persistent' };
    },
    startWithConsent: async (request: PaidRequest) => {
      paid.push(request);
      throw new Error('lost paid start response');
    },
    recoverStart: async (request: { idempotencyKey: string }) => {
      recovered.push(request.idempotencyKey);
      return { session: { id: 'paid-session', token: 'test-only-session', expiresAt: '2099-01-01T00:00:00Z' }, game: {} };
    },
  };
  const options = {
    game,
    scoringGame: {
      startServerValidatedRun: async (request: RunRequest) => { runs.push(request); throw new Error('lost run response'); },
      getActiveScoringEvent: async () => { throw new Error('must not rediscover event during recovery'); },
    },
    variant: 'color-match', root: null, getBalance: () => ({ available: 10 }), getAddress: () => address, storageKey: 'test',
  };
  round = new RoundHarness(options);
  round.storageKey = round.accountStorageKey();
  await round.confirmRound(terms, 'original-paid-key', eventId);
  assert.ok(round.state);
  assert.ok(round.state.run);
  assert.equal(round.state.key, 'original-paid-key');
  assert.equal(paid.length, 2);
  assert.equal(paid[0]?.idempotencyKey, 'original-paid-key');
  assert.equal(paid[1]?.idempotencyKey, 'original-paid-key');
  const originalRunKey = round.state.run.key;
  assert.match(originalRunKey, /^[0-9a-f]{64}$/);
  await round.recover();
  assert.deepEqual(recovered, ['original-paid-key']);
  assert.deepEqual(runs[0], { sessionToken: 'test-only-session', eventId, idempotencyKey: originalRunKey });
  const saved = round.saved.at(-1);
  assert.ok(saved);
  const restored = new RoundHarness(options);
  restored.storageKey = restored.accountStorageKey();
  restored.state = parseSavedRound(JSON.parse(saved));
  await restored.recover();
  assert.equal(paid.length, 2, 'reload/recover must not request new consent or a new paid start');
  assert.equal(recovered.length, 1, 'known paid session is reused');
  assert.deepEqual(runs[1], runs[0], 'same event/run key/session are replayed, even when active-event discovery fails');
});

test('wallet replacement during consent never starts or transfers the old wallet play', async () => {
  let currentAddress = address;
  let starts = 0;
  let round: RoundHarness;
  const game = {
    getAuthorization: () => authorization,
    requestConsent: async () => { currentAddress = '0x2222222222222222222222222222222222222222'; return { consent: {} }; },
    startWithConsent: async () => { starts += 1; throw new Error('must never run'); },
  };
  round = new RoundHarness({ game, scoringGame: {}, variant: 'target-rush', root: null, getBalance: () => ({ available: 10 }), getAddress: () => currentAddress, storageKey: 'test' });
  round.storageKey = round.accountStorageKey();
  const originalStorageKey = round.storageKey;
  await round.confirmRound(terms, 'original-paid-key', eventId);
  assert.equal(starts, 0);
  assert.equal(round.accountStorageKey(), null);
  assert.equal(round.storageKey, originalStorageKey);
  assert.ok(round.state);
  assert.equal(round.state.request.idempotencyKey, 'original-paid-key');
  assert.ok(round.saved.length, 'original wallet recovery is retained');
  currentAddress = address.toUpperCase();
  assert.equal(round.accountStorageKey(), originalStorageKey, 'wallet boundary is case-insensitive');
});

test('memory-only consent never sends a paid start and retains the original attempt for recovery', async () => {
  let starts = 0;
  let recoveries = 0;
  let recovery = 'memory';
  const game = {
    getAuthorization: () => authorization,
    requestConsent: async () => ({ consent: { token: 'memory-only' }, recovery }),
    startWithConsent: async () => { starts += 1; throw new Error('Paid start must not run without durable consent'); },
    recoverStart: async () => { recoveries += 1; throw new Error('Lost recovery response'); },
  };
  const round = new RoundHarness({
    game, scoringGame: {}, variant: 'target-rush', root: null,
    getBalance: () => ({ available: 10 }), getAddress: () => address, storageKey: 'test',
  });
  round.storageKey = round.accountStorageKey();
  await round.confirmRound(terms, 'original-paid-key', eventId);
  assert.equal(starts, 0);
  assert.ok(round.state);
  assert.equal(round.state.key, 'original-paid-key');
  assert.equal(round.state.phase, 'pending');
  assert.equal(parseSavedRound(JSON.parse(round.saved.at(-1) ?? 'null')).request.idempotencyKey, 'original-paid-key');
  await round.recover();
  assert.equal(recoveries, 0, 'Continue must not bypass the failed durability check');
  recovery = 'persistent';
  await round.recover();
  assert.equal(recoveries, 1);
  assert.equal(round.state.request.idempotencyKey, 'original-paid-key');
});
