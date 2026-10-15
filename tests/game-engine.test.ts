import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advance, applyInput, createRun, FLAPPY, gameConfigSchema, gameInputSchema,
  gameSnapshotSchema, gameStateSchema, gameViewSchema, isFinished, LEVELS,
  MAX_TICKS, parseSavedRound, PLATFORM, score, view,
} from '../src/game-engine.js';
import type { GameState } from '../src/game-engine.js';

const flappyRules = { game: 'flappy-bird', maxTicks: 1400, roundTicks: 1200 } as const;
const platformRules = { game: 'platformer', maxTicks: 2600, roundTicks: 2400 } as const;

// These pilots only see legal public positions and use the same controls as a
// player. No snapshot editing, private RNG access, or client result claims.
function fly(seed: number, untilTick: number): GameState {
  let state = applyInput(createRun(seed, flappyRules), { action: 'start' }, 0);
  while (state.tick < untilTick && !state.gameOver) {
    state = advance(state, state.tick + 1);
    const next = state.flappy.pipes.find((pipe) => pipe.x + FLAPPY.pipeWidth > FLAPPY.x);
    if (next && state.flappy.y > next.gapY + FLAPPY.gapHeight / 2 - FLAPPY.size / 2 && state.flappy.vy >= 0) {
      state = applyInput(state, { action: 'flap' }, state.tick);
    }
  }
  return state;
}

test('all three distinct levels are completed from a fresh paid-run state using only legal controls', () => {
  assert.equal(LEVELS.length, 3);
  assert.equal(new Set(LEVELS.map((level) => JSON.stringify(level))).size, 3);
  let state = applyInput(createRun(42, platformRules), { action: 'start' }, 0);
  const transitions: number[] = [];
  const levelScores: number[] = [];
  let previousLevel = 0;
  while (!state.gameOver && state.tick < platformRules.roundTicks) {
    state = advance(state, state.tick + 1);
    if (state.platform.level !== previousLevel) {
      transitions.push(state.platform.level);
      levelScores.push(state.score);
      assert.equal(state.platform.x, 30);
      assert.equal(state.platform.y, PLATFORM.groundY - PLATFORM.height);
      assert.deepEqual(state.platform.coins, []);
      previousLevel = state.platform.level;
    }
    const runner = state.platform;
    const nextHazard = LEVELS[runner.level].hazards.find((hazard) => hazard.x + hazard.w > runner.x);
    const distance = nextHazard ? nextHazard.x - runner.x - PLATFORM.width : Infinity;
    const jump = runner.grounded && distance >= 0 && distance <= 42;
    state = applyInput(state, { action: 'move', direction: 1, jump }, state.tick);
    assert.equal(state.outcome === 'dead', false, `pilot died at level ${runner.level}, x=${runner.x}`);
  }
  assert.deepEqual(transitions, [1, 2]);
  assert.deepEqual(levelScores, [130, 260]);
  assert.equal(state.outcome, 'complete');
  assert.equal(score(state), 400, 'ten ground coins and three goals are awarded once each');
  assert.equal(isFinished(state), true);
  assert.ok(state.tick < 700, 'route finishes comfortably within the official deadline');
  assert.deepEqual(gameStateSchema.parse(state), state);
  assert.equal(advance(state, MAX_TICKS), state);
  assert.equal(applyInput(state, { action: 'start' }, MAX_TICKS), state);
  assert.equal(applyInput(state, { action: 'move', direction: -1, jump: true }, MAX_TICKS), state);
});

test('real seeded pipes award points only after the bird passes them', () => {
  for (const seed of [1, 42, 123, 456, 0xffff_ffff]) {
    const state = fly(seed, 400);
    assert.equal(state.outcome, 'playing', `seed ${seed} remains legally playable`);
    assert.ok(state.score >= 6, `seed ${seed} passed server-generated obstacles`);
    assert.equal(state.score, state.flappy.passed);
    assert.deepEqual(gameStateSchema.parse(state), state);
  }
  const initial = applyInput(createRun(1, flappyRules), { action: 'start' }, 0);
  assert.equal(initial.score, 0);
  assert.equal(applyInput(initial, { action: 'flap', score: 900 }, 1).score, 0);
  assert.notDeepEqual(createRun(1, flappyRules).flappy.pipes, createRun(2, flappyRules).flappy.pipes);
  assert.deepEqual(fly(123, 400), fly(123, 400));
});

test('strict inputs reject forged time, score, position, unknown actions, and wrong-game controls', () => {
  for (const rules of [flappyRules, platformRules]) {
    const ready = createRun(3, rules);
    const started = applyInput(ready, { action: 'start' }, 0);
    for (const input of [
      { action: 'start', serverTick: 5 },
      { action: 'flap', score: 1000 },
      { action: 'move', direction: 1, jump: true, x: 900 },
      { action: 'move', direction: 2, jump: true },
      { action: 'move', direction: 1, jump: 1 },
      { action: 'hit', targetId: 1 },
      { action: 'finish', score: 1000 },
    ]) {
      assert.equal(gameInputSchema.safeParse(input).success, false);
      assert.deepEqual(applyInput(started, input, 1), advance(started, 1));
    }
    const command = rules.game === 'flappy-bird' ? { action: 'move', direction: 1, jump: true } : { action: 'flap' };
    assert.deepEqual(applyInput(started, command, 1), advance(started, 1));
    assert.equal(applyInput(ready, { action: 'flap' }, 1).started, false);
    assert.equal(applyInput(ready, { action: 'move', direction: 1, jump: true }, 1).platform.x, 30);
  }
});

test('duplicate same-tick controls, cooldown, and held jump cannot create extra impulses or points', () => {
  let bird = applyInput(createRun(42, flappyRules), { action: 'start' }, 0);
  assert.equal(applyInput(bird, { action: 'flap' }, 0), bird, 'start consumes the same-tick input slot');
  bird = applyInput(bird, { action: 'flap' }, 1);
  assert.equal(bird.flappy.vy, FLAPPY.flapVelocity);
  assert.equal(applyInput(bird, { action: 'flap' }, 1), bird);
  const cooldown = applyInput(bird, { action: 'flap' }, 2);
  assert.equal(cooldown.flappy.vy, FLAPPY.flapVelocity + FLAPPY.gravity);
  assert.equal(cooldown.flappy.lastFlapTick, 1);
  assert.equal(applyInput(cooldown, { action: 'flap' }, 5).flappy.lastFlapTick, 5);
  assert.equal(cooldown.score, 0);

  let runner = applyInput(createRun(1, platformRules), { action: 'start' }, 0);
  runner = applyInput(runner, { action: 'move', direction: 0, jump: true }, 1);
  assert.equal(runner.platform.vy, PLATFORM.jumpVelocity);
  assert.equal(applyInput(runner, { action: 'move', direction: 1, jump: false }, 1), runner);
  runner = advance(runner, 25);
  assert.equal(runner.platform.grounded, true);
  runner = applyInput(runner, { action: 'move', direction: 0, jump: true }, 26);
  assert.equal(runner.platform.vy, 0, 'holding jump cannot automatically jump again after landing');
  runner = applyInput(runner, { action: 'move', direction: 0, jump: false }, 27);
  runner = applyInput(runner, { action: 'move', direction: 0, jump: true }, 28);
  assert.equal(runner.platform.vy, PLATFORM.jumpVelocity);
  assert.equal(runner.score, 0);
});

test('one-way ledges support legal landings, and collected coins cannot be farmed by backtracking', () => {
  let state = applyInput(createRun(1, platformRules), { action: 'start' }, 0);
  state = applyInput(state, { action: 'move', direction: 1, jump: false }, 1);
  state = advance(state, 26);
  assert.equal(state.platform.x, 180);
  assert.equal(state.score, PLATFORM.coinScore);
  state = applyInput(state, { action: 'move', direction: 0, jump: true }, 27);
  state = advance(state, 40);
  assert.equal(state.platform.y, LEVELS[0].platforms[0]!.y - PLATFORM.height);
  assert.equal(state.platform.grounded, true);
  assert.ok(state.platform.coins.includes(1), 'elevated coin is earned during a real jump');
  state = applyInput(state, { action: 'move', direction: -1, jump: false }, 41);
  state = advance(state, 67);
  assert.equal(state.platform.x, 30);
  state = applyInput(state, { action: 'move', direction: 1, jump: false }, 68);
  state = advance(state, 90);
  assert.equal(state.score, PLATFORM.coinScore * 2);
  assert.deepEqual([...state.platform.coins].sort(), [0, 1]);
});

test('hazards and bird floor collisions terminate immutable runs, and start cannot restart or extend them', () => {
  for (const rules of [flappyRules, platformRules]) {
    let state = applyInput(createRun(4, rules), { action: 'start' }, 0);
    if (rules.game === 'platformer') state = applyInput(state, { action: 'move', direction: 1, jump: false }, 1);
    const startedAt = state.startTick;
    state = applyInput(state, { action: 'start' }, 2);
    assert.equal(state.startTick, startedAt);
    const dead = advance(state, MAX_TICKS);
    assert.equal(dead.outcome, 'dead');
    assert.equal(isFinished(dead), true);
    const before = JSON.stringify(dead);
    for (const input of [{ action: 'start' }, { action: 'flap' }, { action: 'move', direction: -1, jump: true }]) {
      assert.equal(applyInput(dead, input, MAX_TICKS), dead);
    }
    assert.equal(advance(dead, MAX_TICKS), dead);
    assert.equal(JSON.stringify(dead), before);
    assert.deepEqual(gameStateSchema.parse(dead), dead);
  }
});

test('server deadlines, monotonically trusted ticks, and terminal boundaries are enforced', () => {
  for (const game of ['flappy-bird', 'platformer'] as const) {
    const initial = createRun(1, { game, maxTicks: 20, roundTicks: 10 });
    const untouched = JSON.stringify(initial);
    assert.equal(advance(initial, 20).outcome, 'timeout', 'never-started runs still expire');
    assert.equal(advance(initial, Number.MAX_SAFE_INTEGER).tick, 20);
    let state = applyInput(initial, { action: 'start' }, 15);
    assert.equal(state.startTick, 15);
    state = advance(state, 19);
    assert.equal(state.gameOver, false);
    const end = applyInput(state, { action: 'start' }, 20);
    assert.equal(end.tick, 20, 'maxTicks caps a late start');
    assert.equal(end.outcome, 'timeout');
    assert.equal(applyInput(end, { action: 'start' }, 21), end);
    assert.equal(JSON.stringify(initial), untouched, 'advancement never mutates the previous state');
    assert.throws(() => advance(state, 18), /backwards/);
    for (const tick of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => advance(initial, tick), /safe integer/);
  }
  const started = applyInput(createRun(1, { game: 'platformer', maxTicks: 30, roundTicks: 10 }), { action: 'start' }, 2);
  assert.equal(advance(started, 30).tick, 12, 'roundTicks caps an early start');
});

test('catch-up is deterministic, bounded, and equivalent to single trusted ticks', () => {
  for (const rules of [flappyRules, platformRules]) {
    const initial = applyInput(createRun(123, rules), { action: 'start' }, 0);
    let stepped = initial;
    for (let tick = 1; tick <= MAX_TICKS; tick += 1) stepped = advance(stepped, tick);
    const caughtUp = advance(initial, Number.MAX_SAFE_INTEGER);
    assert.deepEqual(caughtUp, stepped);
    assert.ok(Buffer.byteLength(JSON.stringify(caughtUp)) < 64 * 1024);
    assert.ok(caughtUp.tick <= MAX_TICKS);
    assert.deepEqual(gameStateSchema.parse(caughtUp), caughtUp);
  }
  const beginning = applyInput(createRun(3, platformRules), { action: 'start' }, 0);
  const walking = applyInput(beginning, { action: 'move', direction: 1, jump: true }, 1);
  let stepped = walking;
  for (let tick = 2; tick <= 40; tick += 1) stepped = advance(stepped, tick);
  assert.deepEqual(advance(walking, 40), stepped, 'jump, landing, horizontal motion and coins also catch up identically');
});

test('private RNG and input guards never enter public views or official snapshots', () => {
  const state = fly(42, 120);
  const publicView = view(state);
  assert.equal('rngState' in publicView, false);
  assert.equal('lastInputTick' in publicView, false);
  assert.deepEqual(gameViewSchema.parse(publicView), publicView);
  assert.equal(gameViewSchema.safeParse(state).success, false);
  assert.equal(gameStateSchema.safeParse(publicView).success, false);
  publicView.flappy.pipes[0]!.x = 0;
  publicView.platform.coins.push(0);
  assert.notEqual(state.flappy.pipes[0]!.x, 0, 'public projections do not alias private arrays');
  assert.deepEqual(state.platform.coins, []);
  const packet = {
    runId: '11111111-1111-4111-8111-111111111111', configDigest: 'a'.repeat(64),
    serverTick: state.tick, inputSeq: 4, inputTick: state.tick - 1, expiresAt: '2099-01-01T00:00:00Z',
    state: view(state), result: null,
  };
  assert.deepEqual(gameSnapshotSchema.parse(packet), packet);
  assert.equal(gameSnapshotSchema.safeParse({ ...packet, state }).success, false);
  assert.equal(gameSnapshotSchema.safeParse({ ...packet, result: { status: 'expired' } }).success, true);
  assert.equal(gameSnapshotSchema.safeParse({ ...packet, result: { score: '12', status: 'complete' } }).success, true);
});

test('config and private schemas strictly bound the entire simulation state', () => {
  for (const config of [
    { ...platformRules, maxTicks: MAX_TICKS + 1 }, { ...platformRules, roundTicks: MAX_TICKS + 1 },
    { ...platformRules, maxTicks: 0 }, { ...platformRules, roundTicks: -1 },
    { ...platformRules, maxTicks: 100, roundTicks: 200 }, { ...platformRules, game: 'target-rush' },
    { ...platformRules, score: 900 },
  ]) assert.equal(gameConfigSchema.safeParse(config).success, false);
  for (const seed of [-1, 0x1_0000_0000, 1.5, NaN]) assert.throws(() => createRun(seed, flappyRules));
  const state = createRun(0, flappyRules);
  assert.deepEqual(state, createRun(0, flappyRules));
  for (const invalid of [
    { ...state, tick: MAX_TICKS + 1 },
    { ...state, rngState: -1 },
    { ...state, lastInputTick: 1 },
    { ...state, flappy: { ...state.flappy, pipes: Array(100).fill(state.flappy.pipes[0]) } },
    { ...state, platform: { ...state.platform, coins: [0, 0] } },
    { ...state, platform: { ...state.platform, coins: [6] } },
    { ...state, arbitrary: 'private payload' },
  ]) assert.equal(gameStateSchema.safeParse(invalid).success, false);
});

test('v2 paid recovery preserves original idempotency keys, fingerprints, metadata, and new queued inputs', () => {
  const record = {
    version: 2, key: 'original-paid-key', phase: 'playing', extension: { retained: true },
    session: { id: 'paid-session', token: 'secret-paid-token', expiresAt: '2099-01-01T00:00:00Z', serverMetadata: 'kept' },
    request: { idempotencyKey: 'original-paid-key', fingerprint: 'original-fingerprint', expectedCredits: 1, metadata: { game: 'platformer', payment: 'original' }, consentInfo: 'kept' },
    run: {
      eventId: '22222222-2222-4222-8222-222222222222', key: 'original-run-key',
      runId: '33333333-3333-4333-8333-333333333333', configDigest: 'b'.repeat(64),
      serverTick: 0, inputSeq: 1, inputTick: -1, view: view(createRun(9, platformRules)), coordinatorMetadata: 'kept',
      pendingInputs: [{ seq: 1, input: { action: 'start' }, sent: true }, { seq: 2, input: { action: 'move', direction: 1, jump: false } }],
    },
  };
  assert.deepEqual(parseSavedRound(record), record);
  assert.throws(() => parseSavedRound({ ...record, request: undefined }));
  assert.throws(() => parseSavedRound({ ...record, version: 1 }));
  assert.throws(() => parseSavedRound({ ...record, run: { ...record.run, key: undefined } }));
  assert.throws(() => parseSavedRound({ ...record, run: { ...record.run, pendingInputs: [{ seq: 1, input: { action: 'move', direction: 1, jump: false, score: 999 } }] } }));
  assert.throws(() => parseSavedRound({ ...record, run: { ...record.run, view: createRun(9, platformRules) } }));
});
