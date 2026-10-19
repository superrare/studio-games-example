# Studio games example

Two distinct browser games built from one public repository using published npm packages:

- **Target Rush:** click server-issued targets before the round ends.
- **Color Match:** choose the server-requested color. A wrong choice does not earn a point.

Each game has its own Studio app ID, HTTPS origin, immutable deployment, verifier version and scoring event. Register both apps in **one credit group** to share the same wallet's purchased balance. The group owner configures either native ETH or a supported USDC token and pack terms; each purchase quote snapshots the exact currency, amount, token, recipient, wallet and chain. The example charges **1 credit per play**. Network fees are separate.

**This is real payment integration, not a faucet or simulated balance.** Building, previewing, deploying and configuring scoring do not authorize a wallet transfer. Login, buying credits and spending a credit are separate, explicit player actions. Only a completed server result is official. Prizes and contest adjudication remain manual organizer responsibilities; these games are not bot-proof.

## Start here

Follow the [organizer runbook](docs/organizer-runbook.md) for the complete two-game deployment, recovery and acceptance workflow. It includes the current CLI installation reality, bootstrap app allocation, exact origin registration, verifier/event publication and the optional, separately approved real-mainnet wallet check.
For a fast one-off creator onboarding flow, use the [arcade creator handoff](docs/creator-handoff.md): creators build under their own accounts, then the organizer registers each ready app in the existing group.

For game implementation and prize integrity, read the [server-verification guide](docs/server-verification.md): the real Worker contract, copy-paste local and bundled-verifier checks, game-specific anti-cheat design, known bot weaknesses, and the manual result-review/payout checklist. Server-verified scores are not proof of human play or automatic prize eligibility.

### Requirements

- Node.js **22 or newer**, Git, and pnpm **10.11.0** (the repository's declared package manager).
- A Studio creator account and the stable `rare-profile` CLI **0.1.0 or newer** for deployment.
- For an explicitly approved paid check only: a wallet with the configured ETH or USDC asset and sufficient gas, and a treasury the organizer controls.

```sh
git clone https://github.com/superrare/studio-games-example.git
cd studio-games-example
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
npm install --global @rareprotocol/rare-profile@0.1.0
```

The example pins published **Connect 0.11.0** in `package.json`. The CLI command above installs stable **Rare Profile 0.1.0**; no beta tag, SDK checkout, local package archive, private registry or Privy application secret is needed.

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

Both games default to an **All time** top-ten leaderboard. An organizer can deliberately add an optional public config field for a fixed interval, for example:

```json
"leaderboardWindow": {
  "from": "2026-10-19T00:00:00Z",
  "to": "2026-10-26T00:00:00Z"
}
```

These are illustrative dates, not a preset contest or an automatically current week. Choose your own bounds; both must be real ISO calendar timestamps with `Z` (UTC) or an explicit offset, and `from` must be earlier than `to`. Malformed or incomplete timestamps reject configuration. Studio validates ordering at database precision and rejects invalid ranges; an error never falls back to all-time. The games call `getServerLeaderboard({ from, to })` and display the same exact interval/timezones. Studio filters database-owned completed-run `ended_at` in **`[from,to)`** (start included, end excluded) before selecting each identity's best result and the top ten. No browser-clock week calculation, local filtering of all-time leaders, score reset or automatic rollover occurs. Remove the field for the compatible no-argument all-time read. Sample config files intentionally omit it.

Changing this bundled public configuration requires a source rebuild/redeploy and the existing [deployment-pinned verifier/event process](docs/organizer-runbook.md#6-publish-a-verifier-version-and-scoring-event); changing leaderboard display bounds neither updates scoring-event admission bounds nor establishes prize eligibility.

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

- The published Connect SDK provides embedded Connect (the default) or a configured popup, scoped group credits, payment intents, explicit paid-start consent/recovery, server-run start and authoritative scoring reads. If embed is unavailable, the app exposes an explicit popup fallback; it never opens a popup silently. `game.connect()` authorizes through the Studio API without another hosted flow.
- The player shell has one Play entry point, local Practice with no paid-start or score submission calls, a wallet menu with purchase history/recovery, and separate server-verified versus unrecorded practice results. A Play after sign-in or checkout requires fresh spend consent.
- The example calls the SDK's `getActiveScoringEvent()` and `getServerLeaderboard()` (with explicit bounds when `leaderboardWindow` is configured) on the deployed game's own origin. Its server-run client uses that origin too, so WebSocket tickets are used on the correct host. Credit operations use canonical Studio. No copied scoring HTTP client is required.
- Saved purchase, consent, paid-start, server-run and completion records are recovery evidence, not permission to initiate another payment or charge. Preserve original keys after uncertain outcomes and keep records scoped to wallet, group, app and origin. Legacy USDC recovery records migrate losslessly to the currency-aware storage version.
- A fresh account starts with zero purchased credits. No seeded credits, automatic grants, free paid-start fallback or automated prize payouts are included.
- The group operator can explicitly allocate credits using `rare-profile credit-group grant`; see the [operator allocation workflow](docs/organizer-runbook.md#operator-credit-allocations). Allocations need no payment but use the same shared balance and normal per-play consent. The player app cannot allocate credits.
- Wallet leaderboard rows prefer forward-verified ENS names when available, with an address fallback and full-wallet tooltip. ENS metadata never changes score, rank or wallet identity.
- Operators can read time-bounded per-game captured plays and consumed credits through `rare-profile credit-group usage`; see the [usage report workflow](docs/organizer-runbook.md#operator-usage-reports). These counters are not prize amounts or revenue.

## Publishing and contest operations

Update the **same apps** after bootstrap rather than allocating replacement identities. Every scoring deployment needs its root verifier, matching verifier version and an event pinned to that deployment. Group membership survives an update; scoring readiness does not automatically migrate. See the [runbook's publishing and update steps](docs/organizer-runbook.md#6-publish-a-verifier-version-and-scoring-event).

The public top score remains an all-time maximum across completed events/builds for an app. The separate top-ten leaderboard supports an explicit completion-time window, but is not an event-specific standings table, complete eligible entrant ledger, combined-game ranking or prize calculator. Organizers must establish contest windows, eligibility, tie-breaking, result review, prize funding and fulfillment separately.

## Live integration check — 2026-10-15

- [Target Rush](https://y4prnpya.srstudio.dev)
- [Color Match](https://q3s9bpab.srstudio.dev)

These are mainnet integration-test deployments, not free-play demos. Both use one enabled credit group and separate deployment-pinned verifiers and authenticated scoring events. The current source changes are not deployed; do not send money merely to inspect the existing pages.

The source now has a single Play flow, embedded Connect, local Practice, wallet and purchase recovery, and currency-aware purchase handling. Rebuild, redeploy and republish each deployment-pinned verifier/event before using these changes on a live app.

The original 0.8.0 deployment check predates the current source. It does not verify current native ETH checkout, authentication or paid play on those hosted apps.

## Published-package verification

Release verification with **Connect 0.10.0** and stable **Rare Profile 0.1.0** covered a frozen dependency install, typechecking, all 13 tests, both game ZIP builds, real production ENS labels in a local browser, local Practice and an authenticated CLI usage report. No live purchase, credit grant or paid round was performed for this release. Local browser checks do not replace acceptance on each registered HTTPS game origin.

Connect **0.11.0** verification covered a frozen install from npm, typechecking, all **14 tests**, and both game ZIP builds. A fresh Node process using the published dependency passed production all-time, historical-week, current-week, microsecond-window, invalid-range and public CORS/no-store checks; the registry tarball integrity matched the tested release artifact.

Local browser checks covered both variants' all-time and explicit-window empty states, matching request bounds and labels, a visible server-rejected invalid range, a narrow layout without horizontal overflow, refresh, and both free Practice modes scoring locally without any POST request. A temporary GET-only relay forwarded public scoring reads to the real deployed API; the ordinary local preview still does not proxy Studio APIs. Pixel capture was unavailable: browser screenshots timed out and native capture was blocked by macOS Accessibility permissions. No live game redeployment, purchase, credit grant or paid round was performed; registered-origin paid acceptance remains a separate step.

## License

MIT; see [LICENSE](LICENSE).
