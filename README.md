# Studio games example

Two distinct browser games built from one public repository, using the published **`@rareprotocol/connect@0.9.0-beta.0`** npm package, pinned exactly with its lockfile:

- **Target Rush:** click server-issued targets before the round ends.
- **Color Match:** choose the server-requested color. A wrong choice does not earn a point.

Each game has its own Studio app ID, HTTPS origin, immutable deployment, verifier version and scoring event. Register both apps in **one credit group** to share the same wallet's purchased balance. The example offer is **0.01 USDC for 10 credits on Ethereum mainnet**, with **1 credit per play**. Ethereum network fees are separate and can exceed the pack price.

**This is real payment integration, not a faucet or simulated balance.** Building, previewing, deploying and configuring scoring do not authorize a wallet transfer. Login, buying credits and spending a credit are separate, explicit player actions. Only a completed server result is official. Prizes and contest adjudication remain manual organizer responsibilities; these games are not bot-proof.

## Start here

Follow the [organizer runbook](docs/organizer-runbook.md) for the complete two-game deployment, recovery and acceptance workflow. It pins the published rare-profile CLI, explains the deployment-bound scoring registration performed by `app update`, and covers app identity, exact-origin registration, recovery and the optional, separately approved real-mainnet wallet check.

For game implementation and prize integrity, read the [server-verification guide](docs/server-verification.md): the real Worker contract, copy-paste local and bundled-verifier checks, game-specific anti-cheat design, known bot weaknesses, and the manual result-review/payout checklist. Server-verified scores are not proof of human play or automatic prize eligibility.

### Requirements

- Node.js **22 or newer**, Git, and pnpm **10.11.0** (the repository's declared package manager).
- A Studio creator account and `@rareprotocol/rare-profile@0.1.0-beta.4` for deployment.
- For an explicitly approved paid check only: a wallet with Ethereum USDC and sufficient Ethereum gas, and a treasury the organizer controls.

```sh
git clone https://github.com/superrare/studio-games-example.git
cd studio-games-example
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
```

```sh
npm install --global @rareprotocol/rare-profile@0.1.0-beta.4
rare-profile --version
rare-profile login
```

The browser dependency and deployment CLI are published npm packages; no Connect SDK checkout, rare-profile source build, private registry or Privy application secret is needed.

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
  "display": "embed",
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

Keep the game client, verifier and scoring configuration together. The build selects the game variant and emits its matching scoring config (`maxTicks: 240`, `roundTicks: 200`). A raw ZIP upload alone does not create a scoring event; rare-profile beta.4's `app update` registers the verifier and event after the deployment. Studio provisions the root verifier privately rather than serving it as a public static asset.

### Local development and checks

```sh
pnpm dev -- --config ./target-rush.config.json
# Optional: --port 4173
pnpm typecheck
pnpm test
```

Local HTTP is for development, not paid-flow acceptance: Studio registers exact **HTTPS** app origins, and a local page is not your registered deployed origin. Do not loosen origin checks or treat a local score as an official result. Use the deployed HTTPS app for the unpaid Connect smoke and separately approved mainnet payment/play checks.

## Integration boundaries

- Published Connect 0.9.0-beta.0 supplies embedded sign-in and checkout, scoped group credits, payment intents, explicit paid-start consent/recovery, server-run start and authoritative scoring reads. The Connect transport uses a merchant-owned modal iframe; `auth.login()` opens it from the sign-in action, while `game.connect()` remains an API-only authorization exchange. No login or authorization step buys credits or starts a paid play.
- The example calls the SDK's `getActiveScoringEvent()` and `getServerLeaderboard()` on the deployed game's own origin. Its server-run client uses that origin too, so WebSocket tickets are used on the correct host. Credit operations use canonical Studio. No copied scoring HTTP client or separate checkout implementation is required.
- Saved purchase, consent, paid-start, server-run and completion records are recovery evidence, not permission to initiate another payment or charge. Preserve original keys after uncertain outcomes and keep records scoped to wallet, group, app and origin.
- Unreadable purchase recovery records block replacement purchases instead of treating the old payment as absent. Memory-only consent blocks paid start until durable recovery is restored. JavaScript/CSS asset names are content-hashed for Studio's immutable asset cache.
- A fresh account starts with zero purchased credits. No seeded credits, automatic grants, free paid-start fallback or automated prize payouts are included.

## Publishing and contest operations

Update the **same apps** after bootstrap rather than allocating replacement identities. Each game ZIP includes the matching root verifier and scoring config. With rare-profile beta.4, `app update --max-attempts <n>` registers the new deployment's verifier and scoring event; credit-group membership remains tied to the app. See the [runbook's publishing and update steps](docs/organizer-runbook.md#6-register-scoring-for-each-published-deployment).

The public top score spans completed events/builds for an app. It is not an event standings table, weekly winner list, combined-game ranking or prize calculator. Organizers must establish contest windows, eligibility, tie-breaking, result review, prize funding and fulfillment separately.

## Live integration check — 2026-10-16

- [Target Rush](https://y4prnpya.srstudio.dev) — app `25627f68-6ef5-47e3-826d-6632bc6a1f50`
- [Color Match](https://q3s9bpab.srstudio.dev) — app `83868300-84d5-419b-acac-f432cc49d1e9`

These are mainnet integration-test apps, not free-play demos. Both are deployment version `7`, published with `@rareprotocol/rare-profile@0.1.0-beta.4`, and use the shared group at **0.01 USDC / 10 credits**, **1 credit / round**. The game-owned Connect modal embeds hosted login and checkout. Do not send money merely to inspect them; creator publishing did not transfer money or start paid play.

| Game | Deployment | Verifier version | Active scoring event |
| --- | --- | --- | --- |
| Target Rush | `304e95d3-e2aa-47cb-9bda-1d7dfa95b074` | `4d3fb3b0-dbfe-48f7-9ed6-a3a932dd0f8f` | `c649fee9-e457-4aeb-9a5b-14dbc478df71` |
| Color Match | `b0fa7102-8707-4410-86c5-35053306f0f0` | `6099783b-7558-4b3e-ba35-9865371ae72b` | `e43c8e57-deb1-483d-9c71-391a25bca963` |

Both deployed `/config.json` files report `display: "embed"` and both public active-event endpoints returned the event IDs above. The hosted sign-in page rendered inside the modal in each game. Close and Escape removed the iframe; reopening created a fresh login intent. The mobile modal fit a 390×844 viewport without horizontal overflow. No sign-in was completed, wallet action/payment or paid play was performed.

`pnpm typecheck` and all 12 repository tests passed. Both game ZIPs were rebuilt and published as version 7 after the modal lifecycle and mobile sizing fixes. Browser JavaScript console errors were absent; canceled iframe navigations reported expected `ERR_ABORTED` request records.

Not yet exercised: completed player authentication, the embedded-storage-unavailable response, a real USDC transfer/claim, paid rounds, and the purchased-balance transition across both games. Follow the runbook's separately approved mainnet acceptance checklist before treating this as payment/gameplay acceptance.

## License

MIT; see [LICENSE](LICENSE).
