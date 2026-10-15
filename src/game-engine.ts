import * as z from 'zod/mini';

export const TICK_RATE = 20;
export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 450;
export const MAX_TICKS = 2600;
export const FLAPPY = { x: 160, size: 24, pipeWidth: 64, gapHeight: 156, gravity: 1, flapVelocity: -8, terminalVelocity: 12, flapCooldown: 4, pipeSpeed: 5, pipeSpacing: 240 } as const;
export const PLATFORM = { width: 24, height: 30, groundY: 400, speed: 6, gravity: 2, jumpVelocity: -20, terminalVelocity: 18, coinScore: 10, goalScore: 100 } as const;

type Rectangle = { x: number; y: number; w: number; h: number };
type Level = { name: string; width: number; platforms: readonly Rectangle[]; hazards: readonly Rectangle[]; coins: readonly { x: number; y: number }[]; goalX: number };
export const LEVELS: readonly [Level, Level, Level] = [
  {
    name: 'Meadow Steps', width: 1000, goalX: 930,
    platforms: [{ x: 150, y: 320, w: 108, h: 18 }, { x: 510, y: 310, w: 120, h: 18 }],
    hazards: [{ x: 360, y: 378, w: 36, h: 22 }, { x: 720, y: 378, w: 42, h: 22 }],
    coins: [{ x: 108, y: 378 }, { x: 204, y: 300 }, { x: 450, y: 378 }, { x: 570, y: 290 }, { x: 840, y: 378 }],
  },
  {
    name: 'Amber Towers', width: 1200, goalX: 1130,
    platforms: [{ x: 132, y: 328, w: 120, h: 18 }, { x: 534, y: 314, w: 132, h: 18 }, { x: 936, y: 326, w: 108, h: 18 }],
    hazards: [{ x: 330, y: 374, w: 42, h: 26 }, { x: 738, y: 374, w: 36, h: 26 }],
    coins: [{ x: 102, y: 378 }, { x: 192, y: 308 }, { x: 450, y: 378 }, { x: 600, y: 294 }, { x: 864, y: 378 }, { x: 990, y: 306 }],
  },
  {
    name: 'Starlight Summit', width: 1400, goalX: 1330,
    platforms: [{ x: 138, y: 316, w: 114, h: 18 }, { x: 546, y: 324, w: 108, h: 18 }, { x: 954, y: 312, w: 120, h: 18 }],
    hazards: [{ x: 336, y: 376, w: 42, h: 24 }, { x: 744, y: 376, w: 42, h: 24 }, { x: 1152, y: 376, w: 36, h: 24 }],
    coins: [{ x: 102, y: 378 }, { x: 192, y: 296 }, { x: 450, y: 378 }, { x: 600, y: 304 }, { x: 858, y: 378 }, { x: 1008, y: 292 }, { x: 1266, y: 378 }],
  },
];

const boundedInt = (min: number, max: number) => z.int().check(z.gte(min), z.lte(max));
const tickSchema = boundedInt(0, MAX_TICKS);
const positiveTickSchema = boundedInt(1, MAX_TICKS);
const scoreSchema = boundedInt(0, MAX_TICKS);
const seedSchema = z.uint32();
export const gameConfigSchema = z.strictObject({
  maxTicks: positiveTickSchema,
  roundTicks: positiveTickSchema,
  game: z.enum(['flappy-bird', 'platformer']),
}).check(z.refine((rules) => rules.maxTicks >= rules.roundTicks, 'maxTicks must be at least roundTicks'));
export type GameConfig = z.infer<typeof gameConfigSchema>;
export const gameInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({ action: z.literal('flap') }),
  z.strictObject({ action: z.literal('move'), direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]), jump: z.boolean() }),
]);
export type GameInput = z.infer<typeof gameInputSchema>;

const viewFields = {
  tick: tickSchema,
  score: scoreSchema,
  started: z.boolean(),
  gameOver: z.boolean(),
  startTick: z.nullable(tickSchema),
  outcome: z.enum(['ready', 'playing', 'dead', 'complete', 'timeout']),
  rules: gameConfigSchema,
  flappy: z.strictObject({
    y: boundedInt(-24, 480), vy: boundedInt(-8, 12),
    pipes: z.array(z.strictObject({ id: boundedInt(1, 64), x: boundedInt(-64, 1040), gapY: boundedInt(90, 210) })).check(z.maxLength(5)),
    passed: boundedInt(0, 64), lastFlapTick: boundedInt(-4, MAX_TICKS),
  }),
  platform: z.strictObject({
    x: boundedInt(0, 1400), y: boundedInt(0, 450), vy: boundedInt(-20, 18),
    direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    coins: z.array(boundedInt(0, 6)).check(z.maxLength(7)),
    grounded: z.boolean(), jumpHeld: z.boolean(),
  }),
};
type Timeline = { tick: number; started: boolean; startTick: number | null; gameOver: boolean; outcome: string; rules: GameConfig; flappy: { lastFlapTick: number }; platform: { level: 0 | 1 | 2; x: number; coins: number[] } };
function validTimeline(state: Timeline): boolean {
  const deadline = state.startTick === null ? state.rules.maxTicks : Math.min(state.rules.maxTicks, state.startTick + state.rules.roundTicks);
  return state.started === (state.startTick !== null)
    && (state.startTick === null || state.startTick <= state.tick)
    && state.tick <= deadline
    && state.flappy.lastFlapTick <= state.tick
    && (state.outcome === 'ready' ? !state.started && !state.gameOver
      : state.outcome === 'playing' ? state.started && !state.gameOver
      : state.outcome === 'timeout' ? state.gameOver && state.tick === deadline
      : state.started && state.gameOver)
    && (state.tick < deadline || state.gameOver)
    && state.platform.x <= LEVELS[state.platform.level].width - PLATFORM.width
    && state.platform.coins.every((coin, index, coins) => coin < LEVELS[state.platform.level].coins.length && coins.indexOf(coin) === index);
}
export const gameViewSchema = z.strictObject(viewFields).check(z.refine(validTimeline, 'Invalid game timeline'));
export type GameView = z.infer<typeof gameViewSchema>;
export const gameStateSchema = z.strictObject({
  ...viewFields,
  rngState: seedSchema,
  lastInputTick: boundedInt(-1, MAX_TICKS),
}).check(z.refine((state) => validTimeline(state) && state.lastInputTick <= state.tick, 'Invalid private game state'));
export type GameState = z.infer<typeof gameStateSchema>;

function randomStep(state: number): number {
  let value = state;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}
function appendPipe(state: GameState, id: number, x: number): void {
  state.rngState = randomStep(state.rngState);
  state.flappy.pipes.push({ id, x, gapY: 90 + state.rngState % 121 });
}
export function createRun(seed: unknown, config: unknown): GameState {
  const validatedSeed = seedSchema.parse(seed);
  const rules = gameConfigSchema.parse(config);
  const state: GameState = {
    tick: 0, score: 0, started: false, gameOver: false, startTick: null, outcome: 'ready', rules,
    rngState: validatedSeed || 0x9e3779b9, lastInputTick: -1,
    flappy: { y: 200, vy: 0, pipes: [], passed: 0, lastFlapTick: -4 },
    platform: { x: 30, y: 370, vy: 0, direction: 0, level: 0, coins: [], grounded: true, jumpHeld: false },
  };
  if (rules.game === 'flappy-bird') {
    appendPipe(state, 1, 560);
    appendPipe(state, 2, 800);
    appendPipe(state, 3, 1040);
  }
  return state;
}
function copyState(state: GameState): GameState {
  return { ...state, flappy: { ...state.flappy, pipes: state.flappy.pipes.map((pipe) => ({ ...pipe })) }, platform: { ...state.platform, coins: [...state.platform.coins] } };
}
function finish(state: GameState, outcome: 'dead' | 'complete' | 'timeout'): void {
  state.gameOver = true;
  state.outcome = outcome;
}
function flappyStep(state: GameState): void {
  const bird = state.flappy;
  bird.vy = Math.min(FLAPPY.terminalVelocity, bird.vy + FLAPPY.gravity);
  bird.y += bird.vy;
  for (const pipe of bird.pipes) pipe.x -= FLAPPY.pipeSpeed;
  if (bird.pipes[0] && bird.pipes[0].x + FLAPPY.pipeWidth < 0) bird.pipes.shift();
  if (bird.y < 0 || bird.y + FLAPPY.size > WORLD_HEIGHT) {
    finish(state, 'dead');
    return;
  }
  for (const pipe of bird.pipes) {
    if (FLAPPY.x < pipe.x + FLAPPY.pipeWidth && FLAPPY.x + FLAPPY.size > pipe.x
      && (bird.y < pipe.gapY || bird.y + FLAPPY.size > pipe.gapY + FLAPPY.gapHeight)) {
      finish(state, 'dead');
      return;
    }
    if (pipe.x + FLAPPY.pipeWidth <= FLAPPY.x && pipe.id > bird.passed) {
      bird.passed = pipe.id;
      state.score += 1;
    }
  }
  const last = bird.pipes[bird.pipes.length - 1];
  if (last && last.x <= 800) appendPipe(state, last.id + 1, last.x + FLAPPY.pipeSpacing);
}
function overlap(x: number, y: number, w: number, h: number, other: Rectangle): boolean {
  return x < other.x + other.w && x + w > other.x && y < other.y + other.h && y + h > other.y;
}
function platformStep(state: GameState): void {
  const runner = state.platform;
  const level = LEVELS[runner.level];
  const previousBottom = runner.y + PLATFORM.height;
  runner.x = Math.max(0, Math.min(level.width - PLATFORM.width, runner.x + runner.direction * PLATFORM.speed));
  runner.vy = Math.min(PLATFORM.terminalVelocity, runner.vy + PLATFORM.gravity);
  runner.y += runner.vy;
  runner.grounded = false;
  if (runner.y < 0) { runner.y = 0; runner.vy = 0; }
  let floor: number = PLATFORM.groundY;
  if (runner.vy >= 0) {
    for (const platform of level.platforms) {
      if (runner.x < platform.x + platform.w && runner.x + PLATFORM.width > platform.x
        && previousBottom <= platform.y && runner.y + PLATFORM.height >= platform.y) floor = Math.min(floor, platform.y);
    }
    if (runner.y + PLATFORM.height >= floor) {
      runner.y = floor - PLATFORM.height;
      runner.vy = 0;
      runner.grounded = true;
    }
  }
  for (const hazard of level.hazards) {
    if (overlap(runner.x, runner.y, PLATFORM.width, PLATFORM.height, hazard)) {
      finish(state, 'dead');
      return;
    }
  }
  for (let index = 0; index < level.coins.length; index += 1) {
    const coin = level.coins[index];
    if (coin && !runner.coins.includes(index)
      && runner.x < coin.x + 8 && runner.x + PLATFORM.width > coin.x - 8
      && runner.y < coin.y + 8 && runner.y + PLATFORM.height > coin.y - 8) {
      runner.coins.push(index);
      state.score += PLATFORM.coinScore;
    }
  }
  if (runner.x >= level.goalX) {
    state.score += PLATFORM.goalScore;
    if (runner.level === 2) { finish(state, 'complete'); return; }
    runner.level = runner.level === 0 ? 1 : 2;
    runner.x = 30;
    runner.y = PLATFORM.groundY - PLATFORM.height;
    runner.vy = 0;
    runner.grounded = true;
    runner.coins = [];
  }
}

// Only the coordinator supplies serverTick. At most 2600 integer steps, with
// fixed-size geometry and at most four pipes; catch-up allocates one copy.
export function advance(state: GameState, serverTick: number): GameState {
  if (!Number.isSafeInteger(serverTick) || serverTick < state.tick) throw new Error('serverTick must be a nonnegative safe integer and must not move backwards');
  if (state.gameOver || serverTick === state.tick) return state;
  const deadline = state.startTick === null ? state.rules.maxTicks : Math.min(state.rules.maxTicks, state.startTick + state.rules.roundTicks);
  const end = Math.min(serverTick, deadline);
  const current = copyState(state);
  if (!current.started) current.tick = end;
  else {
    while (current.tick < end && !current.gameOver) {
      current.tick += 1;
      if (current.rules.game === 'flappy-bird') flappyStep(current);
      else platformStep(current);
    }
  }
  if (!current.gameOver && current.tick >= deadline) finish(current, 'timeout');
  return current;
}
export function applyInput(state: GameState, input: unknown, serverTick: number): GameState {
  const current = advance(state, serverTick);
  if (current.gameOver) return current;
  const parsed = gameInputSchema.safeParse(input);
  if (!parsed.success || current.lastInputTick === current.tick) return current;
  const command = parsed.data;
  if (command.action === 'start') {
    if (current.started) return current;
    return { ...current, started: true, startTick: current.tick, outcome: 'playing', lastInputTick: current.tick };
  }
  if (!current.started) return current;
  if (command.action === 'flap') {
    if (current.rules.game !== 'flappy-bird' || current.tick - current.flappy.lastFlapTick < FLAPPY.flapCooldown) return current;
    return { ...current, lastInputTick: current.tick, flappy: { ...current.flappy, vy: FLAPPY.flapVelocity, lastFlapTick: current.tick } };
  }
  if (current.rules.game !== 'platformer') return current;
  const jumping = command.jump && !current.platform.jumpHeld && current.platform.grounded;
  return {
    ...current, lastInputTick: current.tick,
    platform: { ...current.platform, direction: command.direction, jumpHeld: command.jump,
      vy: jumping ? PLATFORM.jumpVelocity : current.platform.vy,
      grounded: jumping ? false : current.platform.grounded },
  };
}
export function view(state: GameState): GameView {
  return {
    tick: state.tick, score: state.score, started: state.started, gameOver: state.gameOver,
    startTick: state.startTick, outcome: state.outcome, rules: { ...state.rules },
    flappy: { ...state.flappy, pipes: state.flappy.pipes.map((pipe) => ({ ...pipe })) },
    platform: { ...state.platform, coins: [...state.platform.coins] },
  };
}
export function isFinished(state: GameState): boolean { return state.gameOver; }
export function score(state: GameState): number { return state.score; }

const nonnegativeIntegerSchema = z.int().check(z.gte(0));
const positiveIntegerSchema = z.int().check(z.gte(1));
const finalScoreSchema = z.union([
  nonnegativeIntegerSchema,
  z.pipe(z.pipe(z.string().check(z.regex(/^\d+$/)), z.transform(Number)), nonnegativeIntegerSchema),
]);
const finalResultSchema = z.looseObject({ runId: z.optional(z.uuid()), score: finalScoreSchema, status: z.optional(z.string()) });
const expiredResultSchema = z.looseObject({ runId: z.optional(z.uuid()), score: z.optional(z.never()), status: z.literal('expired') });
const dateSchema = z.string().check(z.refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date'));
const digestSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/i));
const savedTickSchema = z.int().check(z.gte(-1));
export const gameSnapshotSchema = z.union([
  z.object({
    runId: z.uuid(), configDigest: digestSchema, serverTick: nonnegativeIntegerSchema,
    inputSeq: nonnegativeIntegerSchema, inputTick: savedTickSchema, expiresAt: dateSchema,
    state: gameViewSchema, result: z.nullable(z.union([finalResultSchema, expiredResultSchema])), status: z.optional(z.string()),
  }),
  z.object({ error: z.string(), serverTick: z.optional(nonnegativeIntegerSchema) }),
]);
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;
const savedKeySchema = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/));
const savedRoundSchema = z.looseObject({
  version: z.literal(2), key: savedKeySchema,
  phase: z.enum(['pending', 'ready', 'run_pending', 'connecting', 'playing', 'finalizing', 'submitting', 'completed', 'terminal']),
  score: z.optional(nonnegativeIntegerSchema),
  session: z.optional(z.looseObject({ id: z.string().check(z.minLength(1)), token: z.string().check(z.minLength(1)), expiresAt: dateSchema })),
  request: z.looseObject({
    idempotencyKey: z.string().check(z.minLength(1)), fingerprint: z.string().check(z.minLength(1)),
    expectedCredits: positiveIntegerSchema, metadata: z.optional(z.record(z.string(), z.unknown())),
  }),
  result: z.optional(finalResultSchema), completed: z.optional(z.boolean()),
  run: z.optional(z.looseObject({
    eventId: z.uuid(), key: savedKeySchema, runId: z.optional(z.uuid()), configDigest: z.optional(digestSchema),
    startedAt: z.optional(dateSchema), expiresAt: z.optional(dateSchema), view: z.optional(gameViewSchema),
    serverTick: savedTickSchema, inputSeq: nonnegativeIntegerSchema, inputTick: savedTickSchema,
    pendingInputs: z.array(z.object({ seq: positiveIntegerSchema, input: gameInputSchema, sent: z.optional(z.boolean()) })),
  })),
});
export type SavedRound = z.infer<typeof savedRoundSchema>;
export function parseSavedRound(value: unknown): SavedRound { return savedRoundSchema.parse(value); }
