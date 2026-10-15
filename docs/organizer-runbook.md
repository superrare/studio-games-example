# Organizer runbook: Cloudline Arcade

This runbook separates game code from live Studio resources. `README.md` records this workspace's current public app, origin, group and event IDs; they are specific to this rollout, not defaults for another organizer. Creator credentials, wallet keys and payment approvals are not stored here. Do not use placeholder example configs as deployments.

## Pricing and responsibilities

The configured offer is **0.10 USDC for 10 credits** on Ethereum mainnet. USDC has six decimals, so the pack is `100000` atomic units. Each game costs **1 credit per play**. Network fees are separate and may exceed the pack price. Credit purchases and paid plays are real payment flows; building, deployment and scoring publication do not approve a wallet transfer.

One group owns the purchased balance and payment terms. Register two distinct Studio apps (Sky Hopper and Star Runner), each at its exact HTTPS origin, to that group at one credit per play. An app ID is not a group ID, deployment ID, verifier version or event ID. App registration immediately gates ordinary unpaid game sessions, so register only apps you control or are authorized to attach.

Connect owns player identity, authorization, quotes, credit ledger, paid-start consent and recovery. Studio's coordinator owns run admission, server time, input sequencing and final result. The published game ZIP supplies the deterministic verifier. The organizer owns contest terms, eligibility, manual result review and manual payouts. A server result is not proof of human play; read the [verification and abuse limits](server-verification.md) before accepting prize entries.

## Lessons from the first live rollout

- **Allocate IDs before packaging the final apps.** Studio returns an app ID and HTTPS origin when you deploy. If those are needed before the real game is ready, use an unmistakably non-playable bootstrap, then update that same app ID and origin with the finished ZIP. Do not create replacement apps on re-upload.
- **App setup, credit-group setup and scoring setup are separate.** `setup:group` only creates/registers a group for existing apps; it does not deploy apps, publish verifier versions/events, buy credits or approve transfers.
- **Every app update creates a new deployment UUID.** Read `current_deployment_id` after each update. A verifier/event pinned to the previous deployment does not activate for the new one; publish and verify a matching verifier version and event before declaring scoring ready.
- **Embed mode needs both configuration and an adapter.** Set `display: "embed"` and configure the SDK's iframe embed adapter inside a merchant-owned modal. Opening it must require an explicit sign-in or checkout action. Embedded storage can be unavailable in some browsers; report that state rather than silently opening a popup.
- **Attempt limits belong to events, not the whole app.** A new event resets that event's attempt count, while public best scores span events/deployments. Treat `maxAttempts` as one event's cap, not a durable cross-version bot limit. Always-on casual scoring may omit event dates; contests need reviewed, bounded windows.
- **A successful build or live page is not payment acceptance.** Group setup and scoring publication transfer no money. Test real USDC purchases and paid runs only with explicit payer approval; never purchase merely to inspect sign-in or checkout UI.

## Requirements and account setup

Use Node.js 22+, Git, pnpm 10.11.0, and the feature-enabled `rare-profile` CLI. At the 2026-10-15 release check, the CLI feature release was available from public source commit `4a9edb3deb63b0941e34748561d39245ac41a74`; the runbook in this repository originally documented building that CLI release from source while npm's latest beta lagged. Confirm current release reality before installing; never assume `rare-profile` has the credit-group commands.

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Sign in to the CLI as the intended app creator and select your own Studio storefront. CLI credentials are creator deployment access, not a player Connect session or wallet key. Do not put a PAT, session token, private key, treasury override or payment credential in a public game config.

## Allocate two stable apps before registering credits

The safe `setup:group` command needs two existing app UUIDs and their final HTTPS origins. Allocate the two app identities through the current Studio deployment workflow first. If required to obtain permanent origins, deploy only a clearly non-playable static bootstrap that does not request authentication, credits or paid starts. Example bootstrap contents:

```html
<!doctype html><html lang="en"><meta charset="utf-8">
<title>Integration test only</title>
<h1>Integration test only</h1>
<p>Game configuration is not ready. No payments or paid plays.</p>
```

Follow the current rare-profile `app deploy` instructions for your storefront and record each returned app ID and exact HTTPS origin. A bootstrap is still a public deployment; use unmistakable test-only names and never deploy to an unrelated creator's account. Later updates must preserve both app IDs/origins.

## Preview and apply group setup

First run a no-side-effect preview using a real Ethereum treasury you control, a unique group slug, both app IDs and exact approved HTTPS origins:

```sh
pnpm setup:group -- --treasury <controlled-ethereum-address> --slug <unique-group-slug> \
  --flappy-app <studio-app-uuid> --flappy-origin https://<flappy-host> \
  --platformer-app <studio-app-uuid> --platformer-origin https://<platformer-host>
```

Review every generated CLI command. The default and `--dry-run` perform no CLI execution, remote mutation, file creation or wallet payment. The script pins canonical Ethereum USDC, chain 1, 100000 atomic units / 10 credits and registers precisely the two supplied apps at 1 credit each. It refuses existing generated config files.

**Live-capable group creation and registration:** append `--apply` only after independently reviewing the treasury, app ownership, IDs, origins and amount. Creating the group does not itself transfer funds; subsequent purchases send real USDC to the configured treasury. Registration gates unpaid game starts immediately. The script verifies the returned group terms, active/unpaused state, and both 1-credit registrations, then writes ignored `flappy-bird.config.json` and `platformer.config.json`. It never deploys apps, creates scoring events, buys credits or starts a game. On a partial failure it preserves remote changes and reports the group ID; inspect with `rare-profile credit-group get <group-id> --json` and do not blindly run `--apply` again.

Current public CLI commands, as documented for the feature-enabled CLI:

```sh
rare-profile credit-group get <group-id> --json
rare-profile credit-group list --json
rare-profile credit-group list --app <app-id> --json
```

There is no organizer self-service purchase-unpause command in the documented CLI flow. A paused group or payment-term change needs trusted Studio recovery; do not share service-role/database credentials or circumvent the pause.

## Build, update and locally preview

Generated configs have separate app IDs and origins, one shared group ID, embedded Connect modal display and the corresponding variant. They may include the other HTTPS origin as `siblingUrl`. Payment terms come only from Studio's signed quote; config files do not set payment terms.

```sh
pnpm build -- --config ./flappy-bird.config.json --output ./dist/flappy-bird.zip
pnpm build -- --config ./platformer.config.json --output ./dist/platformer.zip
```

Each ZIP has root `index.html`, `config.json`, hashed `assets/`, `server-verifier.js` and `scoring-config.json`. Sky Hopper uses `maxTicks: 1400`, `roundTicks: 1200`; Star Runner uses `maxTicks: 2600`, `roundTicks: 2400`. The build does not create a scoring event or update a live app. Use the current CLI's **app update** operation on the same two app IDs; do not redeploy and accidentally allocate replacement identities.

```sh
pnpm dev -- --config ./flappy-bird.config.json
# or:
pnpm dev -- --config ./platformer.config.json --port 4173
```

Local preview is static HTTP. It is not the approved HTTPS origin and cannot validate official paid starts, sockets, purchases or results. Never label a local score official.

## Publish the pinned verifier and scoring event

Each `app update` produces a new deployment UUID; an event pinned to the previous deployment does not automatically activate for it. After every update, re-read the app's `current_deployment_id`, then publish a matching verifier version and scoring event. Confirm conformance passed and the public active-event endpoint returns the new event before treating server scoring as ready. This creates no player payment. Repeat for the other app with its distinct verifier/config.

For a bounded contest, use creator-authenticated Studio scoring APIs with the **current deployment UUID** and the complete config from that app's ZIP:

```http
POST https://studio.superrare.com/api/v1/games/<app-id>/scoring/versions
Authorization: Bearer <creator-session-jwt>
Content-Type: application/json

{"deploymentId":"<current-deployment-uuid>","config":{"maxTicks":1400,"roundTicks":1200,"game":"flappy-bird"}}
```

```http
POST https://studio.superrare.com/api/v1/games/<app-id>/scoring/events
Authorization: Bearer <creator-session-jwt>
Content-Type: application/json

{"verifierVersionId":"<deployment-version-id>","startsAt":"<reviewed-future-ISO-8601>","endsAt":"<reviewed-later-ISO-8601>","maxAttempts":3,"authPolicy":"authenticated"}
```

Use the ZIP's complete scoring config: for Star Runner the values are 2600, 2400, and `"game":"platformer"`. Obtain the app's current deployment UUID from the creator dashboard; it is not the app ID or integer app version. The app creator needs the Studio `apps` scope for scoring management; a player Connect token, game authorization, paid session or raw CLI PAT is not a creator-scoring Bearer token.

An event mutation creates a new event; inspect event history after any uncertain response before retrying. For always-on, non-prize scoring, start/end dates may be omitted intentionally; for contests, use reviewed bounded windows. `maxAttempts` resets with a new event, while the public app leaderboard spans events/deployments, so this is not a durable cross-version bot limit. Avoid overlapping smoke events that can be selected instead of the intended contest. Confirm each deployed game's public active-event endpoint:

```sh
curl --fail-with-body 'https://<flappy-host>/api/v1/games/<flappy-app-id>/scoring/active-event'
curl --fail-with-body 'https://<platformer-host>/api/v1/games/<platformer-app-id>/scoring/active-event'
```

Event attempt limits apply to scoring identities, not people. Event end and paid-session/run expiry have no automatic finish grace; publish a safe last-start policy. Freeze the rules, verifier and event during prize play. A new deployment needs matching verifier publication and event setup.

## Player flow and payment recovery

Authentication, game authorization, buying credits, and spending a credit are distinct actions. A fresh wallet has zero purchased credits. The explicit purchase flow reads the current Studio quote, verifies mainnet canonical USDC and exactly `$0.10 / 10 credits`, persists recovery evidence, and opens the hosted wallet action only after the player confirms. Wallet transfer UI alone does not prove that credits were claimed; trust Studio's authoritative balance.

Each explicit Play action checks the current app terms are exactly 1 credit and verifies available balance before requesting one-use consent and starting the paid session. Studio charges through the authorized paid `PlaySession`. The browser starts the server-validated run for that paid session and event, then submits ordered movement/flap inputs—never state, score, collision or tick claims. Only the completed verifier result is official. The two apps on different origins read the same group wallet balance; their local recovery records remain separate.

On an uncertain response, recover the same purchase quote/intent/hash, original paid-start idempotency key, session, event and server-run key. Do not create another payment or debit to resolve ambiguity. Storage unreadability or memory-only consent blocks unsafe retry. A socket reconnect recovers the same server run; it does not restart the server clock. Do not clear evidence or change wallets to bypass recovery. See the detailed recovery handling in the existing `PaidRound` and `Credits` implementation and preserve identifiers when contacting trusted support; never share tokens or one-use socket URLs.

## Acceptance boundary

### Safe checks, without a payer

- [ ] Typecheck, tests, both artifact builds and source/bundled verifier checks pass.
- [ ] Both live app registrations identify the intended group, exact HTTPS origin and 1-credit cost.
- [ ] Group state reports chain 1, canonical USDC, controlled treasury, `100000` / 10, and purchases/new uses unpaused.
- [ ] Both deployments have their own current pinned verifier, matching config and active event.
- [ ] On both deployed HTTPS origins, page load/reload does not open hosted UI; explicit sign-in opens the embedded modal, and no purchase or paid run starts without its own user action.
- [ ] Insufficient balance, missing event and failed authorization do not fall back to free play or client-authoritative score.

### Real mainnet acceptance requires explicit payer approval

Never infer paid-flow success from builds or creator credentials. Only with the payer's express approval, verify one 10-credit pack purchase/claim, then one separately confirmed 1-credit play in each game using the same wallet. Confirm Studio's available balance moves from 10 to 9 to 8 and each completed result is attached to its own app/event. Exercise retries by recovering the original operations, not by sending another transfer or start. If no payer approves the wallet actions, report the paid path as unexercised.

## Results, prizes and bot limits

The public top score is app-level and spans events/builds; it is not a contest standings feed or cross-game score. For prize decisions export every page of the creator-only completed-results feed for the exact event:

```http
GET https://studio.superrare.com/api/v1/games/<app-id>/scoring/events/<event-id>/runs?limit=100&offset=0
Authorization: Bearer <creator-session-jwt>
```

Follow `nextOffset` until `null`, deduplicate by run ID, retain identity reference, attempt, score, time and evidence hash, and apply only the rules published before entry. The feed records completed runs, not all inputs or an input replay. Hashes are not proof of human skill. Raw result order does not replace a published tie rule. Keep organizer eligibility decisions separate from original results; verify the recipient and payout separately. There is no automatic anti-bot judgment, contest-wide cross-wallet limit, pooled escrow, winner calculation, disqualification endpoint or payout.

State allowed automation, multi-wallet policy, event/build IDs, time window/timezone, attempts, score aggregation, ties, outage handling, review/appeal and manual payout terms before entries open. A script can send valid inputs; server verification does not distinguish it from a player. Use conservative stakes, independent review and appropriate legal/payment review. Do not promise bot-proof play.
