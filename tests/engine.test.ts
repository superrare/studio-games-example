import assert from 'node:assert/strict';
import test from 'node:test';
import { createRun, gameConfigSchema, gameStateSchema, gameViewSchema, view } from '../src/game-engine.js';
import verifier from '../src/server-verifier.js';

test('server verifier runs both configured variants and keeps private state out of public views', async () => {
  async function call(op: string, fields: Record<string, unknown>, expectedStatus = 200): Promise<unknown> {
    const response = await verifier.fetch(new Request('https://verifier.invalid/v1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, op, ...fields }),
    }));
    assert.equal(response.status, expectedStatus);
    return response.json();
  }
  for (const config of [
    { game: 'flappy-bird', maxTicks: 1400, roundTicks: 1200 },
    { game: 'platformer', maxTicks: 2600, roundTicks: 2400 },
  ]) {
    const response = await call('createRun', { seed: 42, config }) as { result: unknown };
    const state = gameStateSchema.parse(response.result);
    assert.equal(state.rules.game, config.game);
    assert.deepEqual(state, createRun(42, config));
    const publicView = view(state);
    assert.equal('rngState' in publicView, false);
    assert.equal('lastInputTick' in publicView, false);
    assert.deepEqual(gameViewSchema.parse(publicView), publicView);
    await call('view', { state: publicView }, 400);
    await call('submitScore', { score: 999999 }, 400);
  }
  await call('createRun', { seed: 1, config: { game: 'target-rush', maxTicks: 240, roundTicks: 200 } }, 400);
  await call('createRun', { seed: 1, config: { game: 'platformer', maxTicks: 2601, roundTicks: 200 } }, 400);
  const malformed = await verifier.fetch(new Request('https://verifier.invalid/v1', { method: 'POST', body: '{invalid' }));
  assert.equal(malformed.status, 400);
  const otherPath = await verifier.fetch(new Request('https://verifier.invalid/other'));
  assert.equal(otherPath.status, 404);
  assert.equal(gameConfigSchema.safeParse({ game: 'flappy-bird', maxTicks: 1, roundTicks: 2 }).success, false);
});

test('verifier applies server-authoritative input, not browser position or score claims', async () => {
  async function apply(state: unknown, input: unknown, serverTick: number): Promise<unknown> {
    const response = await verifier.fetch(new Request('https://verifier.invalid/v1', {
      method: 'POST', body: JSON.stringify({ version: 1, op: 'applyInput', state, input, serverTick }),
    }));
    assert.equal(response.status, 200);
    return (await response.json()).result;
  }
  const initial = createRun(42, { game: 'platformer', maxTicks: 2600, roundTicks: 2400 });
  const started = await apply(initial, { action: 'start' }, 0);
  assert.equal(gameStateSchema.parse(started).score, 0);
  const forged = await apply(started, { action: 'move', direction: 1, jump: false, score: 999, x: 800 }, 1);
  assert.equal(gameStateSchema.parse(forged).score, 0);
  assert.equal(gameStateSchema.parse(forged).platform.x, 30);
  const moved = await apply(started, { action: 'move', direction: 1, jump: false }, 1);
  assert.equal(gameStateSchema.parse(moved).platform.direction, 1);
});
