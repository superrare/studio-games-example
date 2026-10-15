import assert from 'node:assert/strict';
import test from 'node:test';
import { advance, applyInput, createRun, isFinished, parseSavedRound, score, targetStateSchema } from '../src/target-engine.js';
import verifier from '../src/server-verifier.js';

for (const game of ['target-rush', 'color-match'] as const) {
  test(`${game}: server time owns start, deadline, and final score`, () => {
    const initial = createRun(123, { game, maxTicks: 240, roundTicks: 200 });
    assert.equal(applyInput(initial, { action: 'hit', targetId: 1 }, 1).score, 0);
    const started = applyInput(initial, { action: 'start' }, 2);
    const input = game === 'color-match'
      ? { action: 'choose', targetId: started.target.id, color: started.target.color }
      : { action: 'hit', targetId: started.target.id };
    const hit = applyInput(started, input, 3);
    assert.equal(score(hit), 1);
    assert.equal(applyInput(hit, input, 4).score, 1, 'replayed target cannot score twice');
    const end = advance(hit, 202);
    assert.equal(isFinished(end), true);
    assert.equal(score(applyInput(end, input, 203)), 1);
    assert.equal(advance(initial, 240).gameOver, true, 'a never-started run still expires');
    assert.throws(() => advance(hit, 1), /backwards/);
    assert.deepEqual(targetStateSchema.parse(hit), hit);
  });
}

test('Color Match rejects wrong color, forged hit action, stale ID, extra score, and unstarted input', () => {
  const initial = createRun(456, { game: 'color-match', maxTicks: 240, roundTicks: 200 });
  const started = applyInput(initial, { action: 'start' }, 0);
  const wrong = started.target.color === 'red' ? 'blue' : 'red';
  for (const input of [
    { action: 'choose', targetId: started.target.id, color: wrong },
    { action: 'hit', targetId: started.target.id },
    { action: 'choose', targetId: started.target.id + 1, color: started.target.color },
    { action: 'choose', targetId: started.target.id, color: started.target.color, score: 999 },
  ]) assert.equal(applyInput(started, input, 1).score, 0);
  assert.equal(applyInput(initial, { action: 'choose', targetId: 1, color: initial.target.color }, 1).score, 0);
  const correct = applyInput(started, { action: 'choose', targetId: 1, color: started.target.color }, 1);
  assert.equal(correct.score, 1);
  assert.equal(correct.target.id, 2);
  assert.equal(applyInput(correct, { action: 'start' }, 2).startTick, 0, 'start cannot extend a round');
});

test('Target Rush rejects Color Match inputs and arbitrary client score claims', () => {
  const started = applyInput(createRun(123, { game: 'target-rush', maxTicks: 240, roundTicks: 200 }), { action: 'start' }, 0);
  assert.equal(applyInput(started, { action: 'choose', targetId: 1, color: started.target.color }, 1).score, 0);
  assert.equal(applyInput(started, { action: 'hit', targetId: 1, score: 5000 }, 1).score, 0);
});

test('verifier implements real Workers request protocol and rejects malformed state', async () => {
  const response = await verifier.fetch(new Request('https://verifier.invalid/v1', {
    method: 'POST', body: JSON.stringify({ version: 1, op: 'createRun', seed: 42, config: { game: 'color-match', maxTicks: 240, roundTicks: 200 } }),
  }));
  assert.equal(response.status, 200);
  const payload: unknown = await response.json();
  assert.ok(typeof payload === 'object' && payload !== null && 'result' in payload);
  const state = targetStateSchema.parse(payload.result);
  assert.equal(state.rules.game, 'color-match');
  assert.equal((await verifier.fetch(new Request('https://verifier.invalid/v1', { method: 'POST', body: '{invalid' }))).status, 400);
  assert.equal((await verifier.fetch(new Request('https://verifier.invalid/other'))).status, 404);
});

test('saved round parser rejects missing original paid/run keys and old client-scored records', () => {
  assert.throws(() => parseSavedRound({ version: 1, phase: 'playing', score: 999 }));
  assert.throws(() => parseSavedRound({ version: 2, phase: 'pending', key: 'valid-key' }));
  assert.throws(() => createRun(123, { game: 'target-rush', maxTicks: 100, roundTicks: 200 }));
});
