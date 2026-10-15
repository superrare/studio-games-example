# Studio games example

Two distinct browser games built from one public repository, using the published **`@rareprotocol/connect@0.9.0-beta.0`** npm package, pinned exactly with its lockfile:

- **Target Rush:** click server-issued targets before the round ends.
- **Color Match:** choose the server-requested color. A wrong choice does not earn a point.

Each game has its own Studio app ID, HTTPS origin, immutable deployment, verifier version and scoring event. Register both apps in **one credit group** to share the same wallet's purchased balance. The example offer is **0.01 USDC for 10 credits on Ethereum mainnet**, with **1 credit per play**. Ethereum network fees are separate and can exceed the pack price.

**This is real payment integration, not a faucet or simulated balance.** Building, previewing, deploying and configuring scoring do not authorize a wallet transfer. Login, buying credits and spending a credit are separate, explicit player actions. Only a completed server result is official. Prizes and contest adjudication remain manual organizer responsibilities; these games are not bot-proof.

## Start here

Follow the [organizer runbook](docs/organizer-runbook.md) for the complete two-game deployment, recovery and acceptance workflow. It includes the current CLI installation reality, bootstrap app allocation, exact origin registration, verifier/event publication and the optional, separately approved real-mainnet wallet check.

### Requirements

- Node.js **22 or newer**, Git, and pnpm **10.11.0** (the repository's declared package manager).
- A Studio creator account and the feature-enabled `rare-profile` CLI for deployment. The runbook pins the merged source commit while the required beta is not yet published to npm.
- For an explicitly approved paid check only: a wallet with Ethereum USDC and sufficient Ethereum gas, and a treasury the organizer controls.

```sh
git clone https://github.com/superrare/studio-games-example.git
cd studio-games-example
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
```

The dependency is a published npm release; no Connect SDK checkout, branch build, private registry or Privy application secret is needed.

### Configure and build

Copy `examples/target-rush.example.json` and `examples/color-match.example.json` into your own config files. Replace all placeholder identities and origins with the values allocated by the runbook. The example files are not live deployments and must not be used unchanged.

A per-game public configuration has this shape:

```json
{
  "appId": "<this-game-studio-app-uuid>",
  "groupId": "<your-shared-credit-group-uuid>",
  "studioUrl": "https://studio.superrare.com",
  "apiUrl": "https://api.superrare.com",
  "connectUrl": "https://connect.superrare.com",
  "appOrigin": "https://<this-games-exact-hostname>",
  "display": "popup",
  "game": "target-rush"
}
```

For the second game, set `game` to `color-match`, use its different `appId` and `appOrigin`, and keep the same `groupId`. Optional `siblingUrl` links to the other game's HTTPS page. Never put a treasury override, wallet key, creator token, session credential or service secret in this config: payment terms come from Studio's authoritative quote.

```sh
pnpm build -- --config ./target-rush.config.json --output ./dist/target-rush.zip
pnpm build -- --config ./color-match.config.json --output ./dist/color-match.zip
```

An existing output is not overwritten unless you explicitly add `--force`. Each ZIP contains these paths at its root, not inside an enclosing directory:

```text
index.html
config.json
assets/
server-verifier.js
scoring-config.json
```

Keep the game client, verifier and scoring configuration together. The build selects the game variant and emits its matching scoring config (`maxTicks: 240`, `roundTicks: 200`). Uploading the ZIP does **not** itself create a scoring event. Studio provisions the root verifier privately rather than serving it as a public static asset.

### Local development and checks

```sh
pnpm dev -- --config ./target-rush.config.json
# Optional: --port 4173
pnpm typecheck
pnpm test
```

Local HTTP is for development, not paid-flow acceptance: Studio registers exact **HTTPS** app origins, and a local page is not your registered deployed origin. Do not loosen origin checks or treat a local score as an official result. Use the deployed HTTPS app for the unpaid Connect smoke and separately approved mainnet payment/play checks.

## Integration boundaries

- Published Connect 0.9.0-beta.0 supplies popup authentication, scoped group credits, payment intents, explicit paid-start consent/recovery, server-run start and authoritative scoring reads. Sign-in uses `auth.login()`; `game.connect()` then authorizes through the Studio API without opening another hosted flow. The SDK supports opt-in embedding, but these examples deliberately keep popup authentication.
- The example calls the SDK's `getActiveScoringEvent()` and `getServerLeaderboard()` on the deployed game's own origin. Its server-run client uses that origin too, so WebSocket tickets are used on the correct host. Credit operations use canonical Studio. No copied scoring HTTP client or SDK checkout is required.
- Saved purchase, consent, paid-start, server-run and completion records are recovery evidence, not permission to initiate another payment or charge. Preserve original keys after uncertain outcomes and keep records scoped to wallet, group, app and origin.
- Unreadable purchase recovery records block replacement purchases instead of treating the old payment as absent. Memory-only consent blocks paid start until durable recovery is restored. JavaScript/CSS asset names are content-hashed for Studio's immutable asset cache.
- A fresh account starts with zero purchased credits. No seeded credits, automatic grants, free paid-start fallback or automated prize payouts are included.

## Publishing and contest operations

Update the **same apps** after bootstrap rather than allocating replacement identities. Every scoring deployment needs its root verifier, matching verifier version and an event pinned to that deployment. Group membership survives an update; scoring readiness does not automatically migrate. See the [runbook's publishing and update steps](docs/organizer-runbook.md#6-publish-a-verifier-version-and-scoring-event).

The public top score spans completed events/builds for an app. It is not an event standings table, weekly winner list, combined-game ranking or prize calculator. Organizers must establish contest windows, eligibility, tie-breaking, result review, prize funding and fulfillment separately.

## Live integration check — 2026-10-15

- [Target Rush](https://y4prnpya.srstudio.dev)
- [Color Match](https://q3s9bpab.srstudio.dev)

These are mainnet integration-test deployments, not free-play demos. Both use one enabled credit group at **0.01 USDC / 10 credits**, **1 credit / round**, and have separate deployment-pinned verifiers and authenticated scoring events. Do not send money merely to inspect the example.

The source now uses the published Connect beta. These URLs still represent the original 0.8.0 deployments until the organizer rebuilds, redeploys and republishes their deployment-pinned verifier/events using the runbook; changing the dependency does not update live games automatically.

Original 0.8.0 deployment check: both artifact builds, typecheck, 13 focused regressions, both packaged verifier rounds (including rejection of a wrong color), production verifier conformance/event publication, live active-event and empty server-leaderboard reads, desktop/mobile signed-out rendering, hosted Connect sign-in surfaces with the correct initiating origin, and cancellation without payment or paid-start requests.

Not yet exercised: completed player authentication, a real USDC transfer/claim, paid rounds, and the purchased-balance transition across both games. Those require the payer's explicit wallet approval; creator deployment credentials are not a substitute. Follow the runbook's separately approved mainnet acceptance checklist before treating this as payment/gameplay acceptance.

## License

MIT; see [LICENSE](LICENSE).
