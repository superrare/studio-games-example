# Server verification and abuse limits

This guide covers **Sky Hopper** (`flappy-bird`) and **Star Runner** (`platformer`). A server-derived score means the deployed pinned verifier advanced server-owned state from accepted inputs. It does not establish human play, one-person-per-wallet, or prize eligibility. Server rules prevent browser-submitted totals from becoming official; legal automated inputs remain possible.

## Trust boundary

Studio/Connect owns identity and game authorization, shared-group credit balances, explicit one-credit paid starts, run admission, ordered WebSocket inputs, server time, verifier state and completed results. The browser draws a view and sends bounded inputs. It cannot choose simulation ticks, position, collisions, level completion or score. The creator publishes and pins the verifier for each deployment. The organizer publishes eligibility and automation rules, reviews event results and pays prizes manually.

Never use a browser score, local-storage record, screenshot, community score or public top-score value as prize authority. Use the creator-only completed-run feed for the exact scoring event, following the [organizer runbook](organizer-runbook.md).

## Score-critical implementation

| File | Responsibility |
| --- | --- |
| [`src/game-engine.ts`](../src/game-engine.ts) | Strict rule/config/input/state/view schemas, deterministic physics, levels, collision, deadlines and score |
| [`src/server-verifier.ts`](../src/server-verifier.ts) | Isolated Workers request/response adapter for create, advance, input, view, finish and score |
| [`src/round.js`](../src/round.js) | Existing paid-session/recovery flow, ordered input queue, server snapshots and result completion |
| [`src/game-view.js`](../src/game-view.js) | Canvas rendering and input controls; never assigns score or authoritative simulation state |
| [`src/config.ts`](../src/config.ts) | Variant-specific scoring configs (Sky Hopper 1400/1200 ticks; Star Runner 2600/2400) |
| [`tests/game-engine.test.ts`](../tests/game-engine.test.ts) | Legal completion, replay/forgery, deadline, state bounds and public/private view regressions |

The simulation uses deterministic 20 Hz integer steps and server ticks. Maximum simulation time is 2600 ticks. Each operation has fixed geometry and bounded collections; scoring does not use client wall-clock timestamps or claimed elapsed time. Strict actions carry only `start`, `flap`, or `{ action: "move", direction: -1|0|1, jump: boolean }`. Extra fields such as a claimed score, position, target, collision or timestamp are rejected. The coordinator limits input sequence/rate and supplies previous state from the server.

### Sky Hopper

The verifier simulates vertical gravity and flap impulses, obstacles from private seeded state, pipe collisions, and passes. A point is earned only when the server advances the bird past a pipe. The flap action has a server-enforced cooldown; repeated inputs in one server tick cannot add impulses. The public view omits the private RNG state, so it does not disclose future pipe gaps. The current gap and bird state are visible for rendering; an automated player can still react to visible obstacles or infer timing from gameplay.

The `view` operation omits `rngState` and the input guard from subsequent public projections. The Connect SDK types the initial server-run `state` as unknown, however, and the existing platform example returned a full verifier state at run start. For compatibility, the client accepts either the public projection or a strict private initial state and projects it locally. If the deployed Studio coordinator returns that private form, the initial response exposes the seed-derived generator and pipe positions; a bot can predict later gaps. Confirm the response behavior on the actual deployed coordinator before relying on obstacle secrecy. In either case, do not treat hidden obstacles or seeded RNG as bot detection; server collision and score rules remain authoritative.

### Star Runner

The verifier simulates horizontal movement, gravity, one-way platforms, edge-triggered jumps, collisions with hazards, one-time coin collection and goal transitions. The three distinct levels must be completed in order. A goal awards points once and resets the player and per-level coin set for the next level; the final goal terminates the run. Death and deadlines are terminal. Client input never carries a position or level index. A bot can still send valid movement and jump inputs.

The `tests/game-engine.test.ts` completion route starts from a fresh run and uses only legal controls; it does not edit server state. It is useful for deterministic regression testing, not proof of human skill. Server verification and rate limits increase the cost of attacks but are not bot detection. Multiple wallets and per-event attempt limits do not establish one human per entrant.

## Worker protocol and safe projection

The packaged root `server-verifier.js` exports a default object with `fetch(Request)`. The private platform dispatch uses `POST /v1`, numeric `version: 1`, and a successful `{ version: 1, result }` response. Supported operations are:

| Operation | Server-provided fields | Required result |
| --- | --- | --- |
| `createRun` | seed, published config | Initialized private state |
| `advance` | previous private state, server tick | Time-advanced state; no tick rollback |
| `applyInput` | previous private state, strict untrusted input, server tick | Validated server transition |
| `view` | private state | Public projection without RNG/input guard |
| `isFinished` | private state | Terminal status |
| `score` | private state | Nonnegative safe score from verifier state |

The public view and coordinator snapshot schemas intentionally reject a private state containing `rngState` or `lastInputTick`. Do not replace the projection with the internal state or reintroduce client-side replay as score authority. Malformed envelopes/state return HTTP 400; other paths/methods return 404. An illegal game action does not award points; it can still consume the coordinator's input slot/tick.

## Local acceptance

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

These checks cover the source adapter and rule regressions. The build packages the verifier separately at the ZIP root:

```sh
pnpm build -- --config ./flappy-bird.config.json --output ./dist/flappy-bird.zip
pnpm build -- --config ./platformer.config.json --output ./dist/platformer.zip
```

Review the built archives before publishing: each contains its selected `game` scoring config and matching root verifier. Exercise both bundled artifacts through the adapter as well as source tests when changing rule code. A build, local preview or successful verifier registration is not an official paid-flow acceptance and does not spend credits.

## Adversarial review and contest policy

Before announcing prize play, test the meaningful state transitions and decide what evidence is sufficient:

| Case | Expected result or limitation |
| --- | --- |
| Forged score, position, collision, time or level fields | Strict action/state validation; no score increase |
| Flap or move replay in one tick; held jump; stale controls after death | Same-tick guard/edge-triggered jump/terminal immutability prevent duplicate transitions |
| Hazard collision, pipe collision, level goal, death or timeout | Deterministic server terminal state and score |
| Out-of-order/skipped inputs or multiple inputs in one tick | Coordinator sequencing/rate controls; direct engine tests alone do not prove coordinator behavior |
| Oversized input/state or excessive catch-up | Schema/collection/tick bounds; still review Worker execution limits on platform updates |
| Perfect protocol-legal bot inputs | **Accepted by design.** These games do not identify humans |
| Multiple wallets or replacement events | Per-identity/event controls are not a person-wide cap |
| Reconnect, reload or lost start/finish reply | Recover the same paid key, session, event and run; never silently charge again |
| Public leaderboard or screenshot used as contest result | Not authoritative for an event; use the complete creator-only event feed |

Publish app/event/deployment/rules IDs, window/timezone, attempt limit, allowed automation, multi-wallet policy, score/tie rules, outages, review/appeal process and manual payout steps before entries open. Use conservative stakes and independent review. An observed finalist check is corroborating evidence, not proof of every earlier action. Do not claim a hash, high score, timing guess or server verification proves human play or cheating.

The completed-results feed does not retain an input replay, and its evidence hash is not one. It cannot establish whether valid movement came from a person or bot. Export all pages for the exact event after closure; retain run IDs, scoring identity, attempt number, score, timestamps and evidence hash. Keep eligibility decisions separate from the raw results. Hold payout where evidence is insufficient; never fabricate telemetry or rewrite results. For creator authentication, event publication, deadline and result-feed details, follow the [organizer runbook](organizer-runbook.md).
