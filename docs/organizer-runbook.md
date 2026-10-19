# Organizer runbook: two games, one purchased-credit balance

This guide publishes **Target Rush** and **Color Match** from [the public example](https://github.com/superrare/studio-games-example). It separates creator deployment permissions from the player's wallet approvals. No database access, service-role key, provisioning secret or Privy application secret belongs in an ordinary organizer's workflow or game bundle.

The group owner chooses the immutable group chain and configures either native **ETH** or a supported **USDC** token, plus the exact pack price and credits. ETH prices use wei (18 decimals); USDC prices use token atomic units (normally 6 decimals). Each quote snapshots currency, token, treasury, wallet, amount and timing; payment verification is based on that snapshot. The example charges **1 credit per play**. Network fees are separate. Never assume every group sells the same asset or price.

Before adapting the game rules or accepting prize entries, read the [server-verification guide](server-verification.md). It explains the score-critical implementation, executable verifier checks, current automation/evidence limitations, and the manual review process. This runbook covers publishing and operation; passing verifier registration alone is not a security or fairness review.

## 1. Know what each identity controls

| Identity | Meaning | Shared between these games? |
| --- | --- | --- |
| Creator profile / storefront | Owns published apps; creator auth manages scoring | Yes |
| `groupId` | Organizer, treasury, immutable payment configurations, wallet accounts and purchased-credit ledger | **Yes** |
| `appId` | Stable Studio app identity and credit cost registration | **No** |
| `appOrigin` | Exact approved HTTPS browser origin | **No** |
| Deployment ID | Immutable published client/verifier build | No; changes on each update |
| Verifier version ID | Deployment-pinned module digest plus scoring config | No |
| `eventId` | Scoring window, attempt policy and verifier version | No |
| Wallet | Owns the purchased balance within the group | Use the same wallet for the sharing check |

An app can belong to multiple groups. This example explicitly selects one group; do not infer a group from an app ID or merge balances from unrelated groups. A group's credits do not create a pooled prize fund or combined-game ranking.

**Responsibilities:** Connect handles hosted player identity and wallet actions; Studio verifies quotes, maintains purchased credits, enforces paid starts and executes the pinned verifier; the creator owns game rules and publishing; the organizer owns the treasury, contest terms, support, winner review and manual payouts. A server-derived result is not platform approval for a cash-prize contest.

## 2. Install the tools that actually contain the feature

Use Node.js **22+** and pnpm **10.11.0**. You also need Git and a ZIP utility for the small bootstrap below.

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
git clone https://github.com/superrare/studio-games-example.git
cd studio-games-example
pnpm install
npm install --global @rareprotocol/rare-profile@0.1.0
rare-profile --version
rare-profile credit-group --help
```

The example uses published **Connect 0.10.0** and stable **Rare Profile 0.1.0**. `pnpm install` resolves the pinned Connect release from npm, and the CLI command above installs its stable release. No beta tag, SDK checkout, local package archive, private registry, database credential or Privy application secret is needed.

The SDK provides embedded or popup Connect, group credits, payment intents, explicit consent/recovery, server-run start and authoritative scoring reads. Scoring calls use each deployed game's own origin. Community leaderboards are not a substitute for server results. `game.connect()` authorizes through Studio's API after identity is established.

### Creator CLI capabilities and credentials

Authenticate using the intended creator's account:

```sh
rare-profile login
rare-profile whoami
rare-profile store list --json
```

The CLI manages creator deployment, commerce terms and explicit operator credit allocations. These actions use the existing creator `apps` scope/session and never move money or access a player wallet. Keep `~/.rare-profile/config.json` private; it is not a player Connect session, wallet key or permission to spend ETH/USDC. Do not infer that a locally supplied beta archive is already published to npm.

### Authenticate and choose the existing storefront

```sh
rare-profile login
rare-profile whoami
rare-profile store list --json
```

Approve the CLI in your browser as the intended creator. New default CLI tokens include **`apps`**, `analytics` and `domains`; `apps` permits deployment, group management and creator scoring management. Money-moving scopes are not part of this approval. New-token settings currently expose those default scopes only. `whoami` uses `profile` scope and `store list` uses `storefronts` scope, so either inspection can fail with a new default token even when deployment is authorized. Confirm your creator identity and select your own storefront on the Studio website instead. Do not assume logging in again adds legacy scopes or use another creator's identity to work around a permission error.

If you need the storefront UUID and it is not visible in Studio's UI, the following exact read-only request uses your normal creator browser session, not an extra CLI scope. Run it only in the developer console on the signed-in `https://studio.superrare.com` page and record your own storefront's returned ID:

```js
if (location.origin !== 'https://studio.superrare.com') throw new Error('Use the Studio website');
const storefrontResponse = await fetch('/api/commerce', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'my-storefronts' }),
});
if (!storefrontResponse.ok) throw new Error(`Storefront lookup failed: ${storefrontResponse.status}`);
console.log(await storefrontResponse.json());
```

Studio currently has one storefront per profile. `store create` does not guarantee a separate isolated test storefront. Inspect before changing anything, and use unmistakably test-only app titles: a bootstrap deployment can be publicly listed and can trigger launch notifications.

The normal CLI credential file is `~/.rare-profile/config.json`, containing a personal access token and `baseUrl`. Keep it private. It is creator deployment access, **not** a player Connect session, wallet key or permission to spend ETH or USDC.

## 3. Allocate stable app identities with unpaid bootstraps

You need the final app origin before registering credits and building a game bound to it. Allocate **two** test apps, then update those same apps. A bootstrap is an ordinary small deployment, not a special dummy-app API.

Create a visibly non-playable static bootstrap; it does not load Connect or request money:

```sh
mkdir -p /tmp/studio-game-bootstrap
printf '%s\n' '<!doctype html><html lang="en"><meta charset="utf-8"><title>Integration test only</title><h1>Integration test only</h1><p>Game configuration is not ready. No payments or paid plays.</p></html>' > /tmp/studio-game-bootstrap/index.html
(cd /tmp/studio-game-bootstrap && zip bootstrap.zip index.html)
```

Run from your example checkout, replacing `<storefront-id>` with your selected storefront's actual ID:

```sh
rare-profile app deploy \
  --store <storefront-id> \
  --title "Target Rush — integration test" \
  --price 0 \
  --zip /tmp/studio-game-bootstrap/bootstrap.zip \
  --json

rare-profile app deploy \
  --store <storefront-id> \
  --title "Color Match — integration test" \
  --price 0 \
  --zip /tmp/studio-game-bootstrap/bootstrap.zip \
  --json
```

Record each returned app `id` and `app_url` from the CLI's `{ "ok": true, "data": ... }` response. A listing price of `0` is **not** the credit-pack price and does not waive the registered paid-play requirement. Published apps run as full pages at their permanent HTTPS origins, normally `https://<allocated-host>.srstudio.dev`, not inside an assumed parent iframe bridge or a `/app/<id>/` path.

Derive each origin as scheme + hostname + optional port only. For registration/configuration, remove a trailing slash and any path, query or fragment. Do not construct hostnames from app titles. A custom hostname is a different origin and must be registered/configured deliberately.

Keep a private deployment worksheet with the two app IDs/origins, group ID, deployment IDs, verifier versions, event IDs/windows and artifact versions. These identifiers are not wallet credentials, but should not be copied into this repository as default live configuration.

## 4. Create the mainnet group and register exact origins

**Creation is live-capable.** Migration `083` is applied in production: newly created groups now default to **purchases enabled**. Existing groups retain their previous pause state. There is no platform organizer-approval step or service-role activation requirement for a normal new group. Read the returned state rather than inferring it from an old guide or CLI version string.

Before creating the group, choose a real Ethereum treasury you control and review it independently. Do not use a burn address, sentinel, copied demo address or an uncontrolled test address. Creating a group does not send funds, but it defines where subsequent real purchases go.

```sh
rare-profile credit-group create \
  --slug <your-unique-test-group-slug> \
  --name "My two-game integration test credits" \
  --chain-id 1 \
  --treasury <your-controlled-ethereum-treasury> \
  --currency ETH \
  --pack-price-atomic <price-in-wei> \
  --pack-credits <credits-per-pack> \
  --json
```

For USDC instead, pass `--currency USDC --token-address <supported-mainnet-usdc-address>` and express `--pack-price-atomic` in token atomic units. Arbitrary ERC-20 payments are not supported. Record `data.group.id` and inspect the immutable chain, `currency`, `tokenAddress`, treasury, pack price/quantity, `purchasesPaused` and `newUsesPaused`:

```sh
rare-profile credit-group get <group-id> --json
rare-profile credit-group list --json
```

Choose your pack terms; no sample price is a recommendation or default.

Register **only these isolated test apps** while their paid UI is being prepared:

```sh
rare-profile credit-group add-game <group-id> \
  --app <target-app-id> \
  --origin https://<target-app-hostname> \
  --credits 1

rare-profile credit-group add-game <group-id> \
  --app <color-app-id> \
  --origin https://<color-app-hostname> \
  --credits 1

rare-profile credit-group get <group-id> --json
rare-profile credit-group list --app <target-app-id> --json
rare-profile credit-group list --app <color-app-id> --json
```

**Registration immediately changes access.** An approved registration on an active group gates ordinary unpaid game-session starts, even when purchases are paused. Do not register an existing live app before its paid-start flow works. HTTP localhost is not a permitted registration. Group owners can attach another creator's hosted app without an app-owner confirmation prompt; do not attach somebody else's app without explicit agreement. `list --app` can discover approved memberships beyond your own groups.

### Safely changing payment terms

Changing currency, token, treasury, pack price or pack quantity creates a new immutable payment configuration and automatically pauses purchases. The group's chain, IDs, accounts and balances are preserved; older quotes remain claimable under their original terms. After checking the new terms, only the group owner can explicitly resume purchases:

```sh
rare-profile credit-group update <group-id> \
  --currency ETH \
  --treasury <your-controlled-ethereum-treasury> \
  --pack-price-atomic <price-in-wei> \
  --pack-credits <credits-per-pack>
rare-profile credit-group get <group-id> --json
rare-profile credit-group resume-purchases <group-id>
```

For USDC, include `--token-address <supported-token-address>`. `newUsesPaused` is independent of purchase pause. These creator commands change payment terms and availability only; they do not buy, grant or refund credits. Contact support about an unexpected state with identifiers, not secrets.

### Operator credit allocations

Once Studio migration `085_credit_group_operator_grants.sql` and its commerce handler are deployed, the authenticated group operator can allocate credits to a wallet without a payment:

```sh
rare-profile credit-group grant <group-id> \
  --address <recipient-wallet-address> \
  --credits 3 \
  --idempotency-key campaign-wallet-001 \
  --reason "Campaign allocation" \
  --json
```

Review the recipient and quantity before running this mutation. Credits must be a whole number from 1 through 2147483647. Supply a reason of 1–500 characters after trimming, and an 8–128-character key matching `[A-Za-z0-9][A-Za-z0-9._:-]{7,127}`. Reuse the same key, wallet, quantity and reason after an uncertain response; identical retries return the same receipt without adding credits again. A changed payload with that key returns 409. Use a new key only for a deliberate new allocation.

The server derives the operator from authentication and checks group ownership inside the allocation transaction. Other creators and player/game credentials cannot allocate; backend service credentials and database administrators remain trusted. The recipient account is resolved or created within that group and chain. The immutable receipt records the grant, account, recipient, operator, amount, reason, key and timestamp, not a mutable balance.

Allocations increase the existing shared credit balance, require no ETH/USDC transfer, and do not check NFT ownership. Disabled groups reject allocation; purchase/new-use pauses remain unchanged. A grant does not bypass normal per-play consent or a spending pause. It is not a refund or credit-revocation feature. This manual operation is separate from local, unrecorded Practice.


### Operator usage reports

After Studio migration `086_credit_group_usage.sql` and the commerce reporting handler are deployed:

```sh
rare-profile credit-group usage <group-id> \
  --from 2026-10-19T00:00:00Z \
  --to 2026-10-26T00:00:00Z \
  --limit 100 --json
```

Choose the timezone-qualified bounds deliberately; no local week is inferred. Only the current group operator can read the report. It counts immutable capture-ledger timestamps in `[from,to)`: charged plays and consumed credits by game, including currently suspended registrations and disabled groups. `completedPlays` means current completion status for those captured plays, not runs completed during the week. Uncharged reservations/cancellations and purchases/grants do not count; charged abandoned/expired plays still do.

All counters are decimal strings. `totals` is the complete window, while `games` is one UUID-ordered page. If `page.hasMore`, repeat with the same range and `--after <page.nextCursor>`; pages are separate snapshots, not a frozen export. Limit is 1–100, default 100. The SDK method is `creditGroups.usage`.

Credits spent do not imply an ETH revenue amount or distinguish paid from granted credits. Pool allocations and payouts remain organizer decisions. Never embed creator credentials in a public pool app; publish a deliberately public summary from a trusted operator process instead.

### ENS leaderboard labels

The games prefer a forward-verified `player.ensName` for wallet scorers while retaining the full wallet address as a tooltip. Studio resolves Ethereum-mainnet ENS through its server-only `ALCHEMY_API_KEY`; no browser secret or player signature is needed. Missing names/configuration, failed lookups and deadlines preserve wallet labels and scores. Names do not change identity, ranking or prize eligibility.

## 5. Build and update the same two apps

Make two local config files from `examples/target-rush.example.json` and `examples/color-match.example.json`. Replace all identity/origin placeholders. The public config schema is:

```json
{
  "appId": "<target-app-uuid>",
  "groupId": "<shared-group-uuid>",
  "studioUrl": "https://studio.superrare.com",
  "apiUrl": "https://api.superrare.com",
  "connectUrl": "https://connect.superrare.com",
  "appOrigin": "https://<target-app-hostname>",
  "display": "embed",
  "game": "target-rush"
}
```

`display` defaults to `embed`; `popup` is an explicit configuration option. The player flow provides one Play button, local unrecorded Practice, a wallet/purchase recovery menu, and separate official versus practice results. Pack price and currency are never set in this public game config; the player reviews the current server quote. Keep the second game on the same `groupId` but its own `appId` and `appOrigin`. Never place treasury overrides, private keys, PATs, JWTs, session tokens or Privy secrets here.

```sh
pnpm build -- --config ./target-rush.config.json --output ./dist/target-rush.zip
pnpm build -- --config ./color-match.config.json --output ./dist/color-match.zip

rare-profile app update <target-app-id> --zip ./dist/target-rush.zip --json
rare-profile app update <color-app-id> --zip ./dist/color-match.zip --json
```

If intentionally replacing an existing local output ZIP, add `--force` to the build command. Do not run `app deploy` again: that would allocate another app identity/origin rather than update the registrations you just created. The update response returns `product_id`, `version` and `app_url`; it does **not** return the immutable deployment UUID.

Each ZIP must have root `index.html`, `config.json`, `assets/`, `server-verifier.js` and `scoring-config.json`. The build emits the selected game variant's matching config with default `maxTicks: 240` and `roundTicks: 200`. The server owns ticks; client animation or local clock is not official time. Keep client/verifier/config versions matched. Studio removes `server-verifier.js` from public static assets and provisions it privately. A missing public verifier URL is not evidence that the module failed to publish.

For development only:

```sh
pnpm dev -- --config ./target-rush.config.json
# Optional custom port: pnpm dev -- --config ./target-rush.config.json --port 4173
pnpm typecheck
pnpm test
```

A local HTTP development server is not the registered HTTPS app and is not paid-flow acceptance. Do not relax origin checks, simulate credit balances or call a local preview score official. Building and deploying are creator operations; none of these commands authorizes a real wallet transfer.

## 6. Publish a verifier version and scoring event

A ZIP upload and credit registration are not enough for server-scored play. Every current deployment needs a verifier version and an event **for that deployment**. `scoring-config.json` is an artifact for the organizer to publish, not an automatic event-creation trigger.

Implementers: use the [verifier contract and local exercises](server-verification.md#3-implement-the-verifier-contract-correctly) before publishing, and review the [adversarial acceptance matrix](server-verification.md#6-adversarial-acceptance-matrix) before admitting prize entries.

### Dashboard path for the unpaid integration smoke

1. Sign in at `https://studio.superrare.com` as the **app creator**. Open `/dashboard/apps/<app-id>` and its **Deployments** tab.
2. Confirm the current deployment reports a custom verifier. Paste the complete matching `scoring-config.json` from that game's ZIP into **Verifier configuration (JSON)**, including its game variant field. Do not paste Target Rush's config for Color Match.
3. Set **Attempts per player** deliberately (for example `20` for an integration smoke), then choose **Enable server scoring**.
4. The dashboard sends the current active deployment ID and config to the versions endpoint, then creates an event with `authPolicy: "authenticated"`. This accepts verified wallets as well as Studio profiles; it is not a Studio-account-only policy. It does not spend a credit or approve a wallet transaction.
5. Repeat for the second app. Confirm each deployed origin's active-event endpoint below returns its own event ID.

The dashboard's convenience control currently creates an event **without explicit start/end bounds** and returns early if an event is already active. Changing its text fields and clicking again is not an event-update mechanism. Use the creator HTTP endpoints for a deliberately bounded contest; do not describe the smoke event as a weekly contest.

### Exact creator HTTP authentication

Scoring management requires the **app creator's Studio session JWT**, either a normal same-origin Studio login cookie or `Authorization: Bearer <sessionToken>` obtained by exchanging the CLI PAT. A player `ConnectSession`, a scoped `GameAuthorization`, a `PlaySession`, and the raw `slk_...` CLI PAT are **not** creator scoring Bearer tokens. The backend checks creator ownership and the CLI **`apps`** scope (`manage-game-leaderboards`). Group ownership alone does not let a different creator manage an app's scoring.

This read-only command uses the local CLI credential without printing it or putting it in command arguments. It exchanges `POST /auth/cli/exchange` with `{ "token": localPAT }`, checks the returned scope, then calls the authenticated scoring-version/event APIs. Set `APP_ID` to one of your actual app IDs first:

```sh
export APP_ID='<this-game-app-uuid>'
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const base = 'https://studio.superrare.com';
const config = JSON.parse(await readFile(join(homedir(), '.rare-profile/config.json'), 'utf8'));
// Use canonical Studio explicitly; older CLI config may still say beta.rare.xyz.
if (!/^[0-9a-f-]{36}$/i.test(process.env.APP_ID ?? '')) throw new Error('Set APP_ID');
const exchanged = await fetch(`${base}/auth/cli/exchange`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: config.token }),
});
if (!exchanged.ok) throw new Error(`Creator exchange failed: ${exchanged.status}`);
const auth = await exchanged.json();
if (!auth.sessionToken || !auth.scopes?.includes('apps')) throw new Error('Creator apps scope required');
for (const suffix of ['versions', 'events']) {
  const response = await fetch(`${base}/api/v1/games/${process.env.APP_ID}/scoring/${suffix}`, {
    headers: { Authorization: `Bearer ${auth.sessionToken}` },
  });
  if (!response.ok) throw new Error(`${suffix} failed: ${response.status}`);
  console.log(JSON.stringify({ resource: suffix, data: await response.json() }, null, 2));
}
NODE
```

A session JWT lasts 15 minutes; exchange again when expired. Do not print, commit, upload, paste into an issue, or bundle either credential. The command prints scoring metadata, not the credentials. After dashboard setup, `verifierVersions` contains the version's `id`, `deployment_id`, config and digest. Record the version created for your current deployment, not simply any older version in the array.

### Version registration and bounded events

The exact mutation contracts are:

```http
POST https://studio.superrare.com/api/v1/games/<app-id>/scoring/versions
Authorization: Bearer <creator-session-jwt>
Content-Type: application/json

{"deploymentId":"<current-published-deployment-uuid>","config":{"maxTicks":240,"roundTicks":200,"game":"target-rush"}}
```

Use the complete generated scoring config for your selected game; do not assume optional or future rules can be omitted. For Color Match use its generated variant. The response is `{ "version": "1", "verifierVersion": { "id": "...", ... } }`. Registration requires the **current active deployment**, its root verifier and passing initial conformance. The same deployment/config digest can return the existing version. Conformance is technical validation, not fairness approval.

The deployment UUID is not the app ID, app update's integer `version`, or app hostname. After dashboard setup it appears in version metadata. For direct publication, creator-authenticated `POST /api/commerce` with `{ "action": "my-products" }` returns `{ "products": [...] }`; select your app by `id` and read its `current_deployment_id`. **That lookup requires `products` scope for a CLI token**, beyond `apps` for scoring management. New CLI token settings expose only the default scopes, so an ordinary new token cannot use this lookup. Use your normal Studio browser session below (unrestricted creator auth), or an existing appropriately scoped token. Never request database/service-role access or claim that re-login supplies `products` scope.

For a bounded event, use the current verifier version and choose future ISO-8601 bounds with a timezone. The following request illustrates a one-week UTC contest window; **replace these dates if they are not in the future**, and publish the equivalent local times in your contest terms:

```http
POST https://studio.superrare.com/api/v1/games/<app-id>/scoring/events
Authorization: Bearer <creator-session-jwt>
Content-Type: application/json

{"verifierVersionId":"<this-deployment-verifier-version-uuid>","startsAt":"2026-11-01T00:00:00Z","endsAt":"2026-11-08T00:00:00Z","maxAttempts":3,"authPolicy":"authenticated"}
```

These are actual HTTP contracts, not hypothetical `rare-profile scoring ...` commands. **For an ordinary organizer with a new apps-scoped CLI token, use the browser-session path:** sign in as the app creator at `https://studio.superrare.com`, open that site's developer console, review the following script, replace its app ID/config/window, and run it there. It uses the site's existing HttpOnly session cookie (`credentials: 'same-origin'`), not a copied token. Do not run it on the game's origin, another site or an untrusted page. Paste your selected ZIP's complete `scoring-config.json` as `scoringConfig`; the shown object is Target Rush's current default.

```js
{
  if (location.origin !== 'https://studio.superrare.com') throw new Error('Use the Studio website');
  const appId = '<this-game-app-uuid>';
  const scoringConfig = { maxTicks: 240, roundTicks: 200, game: 'target-rush' };
  const startsAt = '2026-11-01T00:00:00Z';
  const endsAt = '2026-11-08T00:00:00Z';
  async function creatorRequest(path, body) {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return response.json();
  }
  const owned = await creatorRequest('/api/commerce', { action: 'my-products' });
  const app = owned.products?.find(product => product.id === appId);
  if (!app?.current_deployment_id) throw new Error('Owned published app not found');
  const path = `/api/v1/games/${appId}/scoring`;
  const version = await creatorRequest(`${path}/versions`, {
    deploymentId: app.current_deployment_id, config: scoringConfig,
  });
  if (!version.verifierVersion?.id) throw new Error('Invalid verifier response');
  const event = await creatorRequest(`${path}/events`, {
    verifierVersionId: version.verifierVersion.id, startsAt, endsAt,
    maxAttempts: 3, authPolicy: 'authenticated',
  });
  console.log({ deploymentId: app.current_deployment_id, verifierVersion: version.verifierVersion, event: event.event });
}
```

**Every execution creates an event.** After an uncertain reply, inspect the authenticated event list before rerunning. The script does not move money. Repeat separately for Color Match with its own ID and generated config. Adjust the dates and policy before launch; avoid overlapping smoke events as explained below.

**Optional terminal path for an existing broader-scoped token:** the following complete command obtains the current deployment through `my-products`, reads the matching config directly from the built ZIP, registers its version, and creates a bounded event. It requires a CLI token that already has **`apps` and `products`** scopes and the `unzip` utility; a new default token will correctly fail its scope check. Set your app ID/artifact and reviewed future dates; repeat separately for the second app. Do not blindly rerun after an uncertain event response.

```sh
export APP_ID='<this-game-app-uuid>'
export GAME_ZIP='./dist/target-rush.zip'
export EVENT_START='2026-11-01T00:00:00Z'
export EVENT_END='2026-11-08T00:00:00Z'
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const base = 'https://studio.superrare.com';
const saved = JSON.parse(await readFile(join(homedir(), '.rare-profile/config.json'), 'utf8'));
const appId = process.env.APP_ID;
if (!/^[0-9a-f-]{36}$/i.test(appId ?? '')) throw new Error('Set APP_ID');
if (!process.env.GAME_ZIP) throw new Error('Set GAME_ZIP');
const startsAt = process.env.EVENT_START;
const endsAt = process.env.EVENT_END;
if (!startsAt || !endsAt || !Number.isFinite(Date.parse(startsAt))
  || !Number.isFinite(Date.parse(endsAt)) || Date.parse(startsAt) >= Date.parse(endsAt)
  || Date.parse(endsAt) <= Date.now()) throw new Error('Set a valid future event window');
const scoringConfig = JSON.parse(execFileSync('unzip', ['-p', process.env.GAME_ZIP, 'scoring-config.json'], { encoding: 'utf8' }));
const exchange = await fetch(`${base}/auth/cli/exchange`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: saved.token }),
});
if (!exchange.ok) throw new Error(`Creator exchange failed: ${exchange.status}`);
const auth = await exchange.json();
if (!auth.sessionToken || !['apps', 'products'].every(scope => auth.scopes?.includes(scope))) {
  throw new Error('Creator apps and products scopes required');
}
async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.sessionToken}` },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}
const owned = await post('/api/commerce', { action: 'my-products' });
const app = owned.products?.find(product => product.id === appId);
if (!app?.current_deployment_id) throw new Error('Owned published app not found');
const path = `/api/v1/games/${appId}/scoring`;
const version = await post(`${path}/versions`, {
  deploymentId: app.current_deployment_id, config: scoringConfig,
});
if (!version.verifierVersion?.id) throw new Error('Invalid verifier response');
const event = await post(`${path}/events`, {
  verifierVersionId: version.verifierVersion.id, startsAt, endsAt,
  maxAttempts: 3, authPolicy: 'authenticated',
});
console.log(JSON.stringify({ deploymentId: app.current_deployment_id, verifierVersion: version.verifierVersion, event: event.event }, null, 2));
NODE
```

Set `APP_ID`, `GAME_ZIP`, `EVENT_START` and `EVENT_END` to reviewed values before running it. This mutation creates an event; it does not pay, grant credits, or run the game. The response contains `event.id`. There is no event-mutation/closing endpoint documented by this workflow. Avoid overlapping active events: active-event discovery selects the **newest created active event whose window contains now for the current deployment**. A future-window event does not disable an older unbounded smoke event; that older event can be selected before the contest starts or after it ends. For a real bounded launch, use a fresh deployment with only the intended bounded event, and verify discovery outside and inside the window. Keep smoke events out of prize eligibility regardless.

Public discovery needs no creator credential:

```sh
curl --fail-with-body 'https://<target-app-hostname>/api/v1/games/<target-app-id>/scoring/active-event'
curl --fail-with-body 'https://<color-app-hostname>/api/v1/games/<color-app-id>/scoring/active-event'
```

Successful responses contain `{ "version": "1", "eventId": "..." }`. HTTP 404 can mean no currently active event for this deployment; it is not permission to charge for a new attempt while scoring is unavailable.

## 7. Player flow: four separate approvals and authoritative results

The deployed game owns visible UI and recovery records, not the credit ledger. Never replace these steps with a client-selected ETH/USDC transfer or a browser-submitted score.

1. **Sign in explicitly.** Connect opens in the page by default; a creator may configure popup mode, and unsupported embeds require an explicit popup retry. The app exchanges the Connect credential for a short-lived `GameAuthorization` bound to wallet, group, app and exact origin. Login/connection must not buy, reserve or start a play.
2. **Choose a purchase explicitly.** Show the authoritative quote's currency, token (if any), atomic amount, pack credits, chain, recipient and expiry before transfer. ETH amounts are wei; USDC amounts use that token's atomic units. Persist the quote, wallet/scope and snapshotted terms. The wallet must match the quote payer.
3. **Claim the payment.** Preserve the hosted transfer intent ID before opening checkout, then the returned transaction hash. Connect transfers native ETH or supported USDC; no arbitrary ERC-20 path is offered. Studio checks the exact quote's currency/asset, payer, recipient, amount, chain, successful canonical receipt and payment time. Smart-account ETH transfers require matching non-reverted `CALL` trace evidence; missing trace/RPC evidence fails closed. The server uses `ALCHEMY_API_KEY` to derive the chain-specific RPC; there is no global node URL override or public-node fallback. Only claim success and the authoritative balance establish credits.
4. **Confirm each credit spend explicitly.** The one Play button signs in and authorizes the game as needed, guides the player to buy a pack if their balance is insufficient, then requests fresh one-use consent before a paid start. Persist the attempt key, fingerprint, expected cost, original start fields and consent before paid start. Studio reserves the cost and captures the debit once initialization succeeds.
5. **Run and finish on the server.** Resolve the event on the game's own origin, save a separate server-run key, and start with the paid PlaySession. The browser sends ordered player inputs, not score/state/time. Target Rush uses server-issued targets; Color Match uses server-issued desired colors and wrong choices must not score. Only the server's terminal result is official. Local Practice makes no paid-start or official-score calls and is clearly unrecorded. Complete the paid PlaySession after terminal confirmation and recover completion for that same session if necessary.

Available, total purchased and reserved balances are distinct. New wallets have **zero** purchased credits: there is no seeded pack, weekly reset, faucet or automatic allowance. Insufficient funds should offer an explicit purchase, never initiate one. Registered apps' ordinary `/games/:appId/sessions` path is gated with HTTP 402; it is not a paid-start bypass.

### Recovery rules: uncertainty is not permission to charge again

| Situation | Recover the original operation | Never do this |
| --- | --- | --- |
| Checkout popup closed / transfer reply lost | Read the saved intent through `client.intents.get({ intentId })`; preserve quote and hash | Assume no transfer happened and send another |
| Claim pending (`PAYMENT_PENDING`) / verification outage | Retry the **same** purchase claim/hash; refresh authoritative balance | Create a replacement payment to fix a timeout |
| Consent/start reply lost | `recoverStart` with the original request fields and idempotency key, saved consent/fingerprint/cost | Generate a new key, clear uncertain evidence, or silently spend again |
| Scoring run start / socket reply lost | Recover with the same event, paid session and server-run key; obtain a fresh one-time ticket | Reuse an already consumed WebSocket ticket or buy a second play |
| Completion reply lost | Retry completion for the same paid session | Start another session to close the old one |
| Wallet switch / logout / reload | Use only records matching wallet + group + app + origin; reauthorize the correct account | Replay wallet A's payment/start under wallet B |

Connect's `requestConsent` reports recovery durability. This example blocks paid start when `recovery: "memory"` and retains the original attempt; keep the page alive, restore browser storage, and choose Continue to retry persistence before that same attempt can proceed. Unreadable purchase recovery records similarly block replacement purchases instead of treating an uncertain payment as absent. Do not clear the existing evidence. A changed credit price requires refreshed terms and a new visible confirmation. Expiry alone does not prove that an uncertain debit or run failed. Ambiguous retained reservations need trusted operator reconciliation, not client balance edits or automatic refunds.

Do not clear browser storage while recovering a payment/start. A different app origin has separate browser storage: switching to the second game demonstrates the **server balance**, not cross-origin sharing of recovery secrets. Preserve support-safe identifiers (purchase/use/run/event IDs and transaction hash); do not send authorization tokens or one-time socket URLs to support.

## 8. Unpaid smoke, then a separately approved mainnet acceptance

### Safe unpaid smoke

- [ ] Clone and install from the supplied Connect/CLI archives; do not rely on an unpublished npm release or SDK checkout.
- [ ] Confirm both ZIPs contain root client/config/verifier/scoring artifacts and different game variants.
- [ ] Check app IDs/origins against CLI deployment responses; confirm both approved registrations cost `1` credit in the same group.
- [ ] Inspect the group's immutable chain, currency/token, treasury, pack terms, purchase pause and new-use pause before enabling the purchase UI.
- [ ] Update both original app IDs; publish each current deployment's matching verifier/event and verify its active-event endpoint.
- [ ] Open each deployed HTTPS page. Check both game variants and errors. No transfer, claim, consent, reservation or run should begin on load/reload.
- [ ] Exercise the single Play entry: embed or configured popup sign-in, game authorization, insufficient-balance handoff to the wallet menu, purchase recovery visibility, and explicit one-credit consent. No real transfer is needed for this check.
- [ ] Run both local Practice modes. Confirm controls work and each result is labeled local/unrecorded; no paid start or official score is sent.
- [ ] Confirm wallet menu exposes current account, balance, sign-out/switch and saved purchase recovery without starting a transaction when merely opened.
- [ ] Open/cancel a purchase quote before wallet approval if testing cancellation; quoting alone is not a transfer. Preserve any pending quote/intent information.
- [ ] Ensure missing authorization, active event or credits produce actionable errors, never unpaid official scoring.

These checks can establish deployment/auth/configuration, **not** successful paid acceptance. Do not say that a built ZIP or a successful creator API request proves payment or gameplay.

### Explicit real-mainnet wallet step

This is optional and requires the payer's explicit approval. Agree on the exact configured currency, pack credits/amount, chain, recipient and **one credit per explicitly confirmed play**. For a test of the new native path, use a group configured for ETH; USDC tests only the existing token path. Creator CLI access is not payer approval. Never automate a transfer or credit grant as part of deployment.

- [ ] The payer selects Buy in Target Rush, reviews the quote (asset, atomic amount, credits, recipient, chain, expiry) and explicitly approves the Connect wallet action. Record purchase ID and transaction hash without logging secrets.
- [ ] Claim that quote and confirm available balance increases by the quoted `packCredits`, exactly once. Repeating the same successful claim must not grant a second pack. Never submit a duplicate transfer to test idempotency.
- [ ] Confirm Play's one-credit spend once in Target Rush. Finish a server-scored round; the balance falls by one, and the end screen labels the server score as recorded.
- [ ] Open Color Match on its different origin and connect the same wallet. It reads the same group's remaining balance without another purchase.
- [ ] Confirm one Color Match play; verify the wrong color earns no point, then finish the server-scored round. Balance reflects the two one-credit spends and any other operations.
- [ ] Exercise saved quote/claim and paid-start/server-run recovery without generating a fresh payment or idempotency key.
- [ ] Switch wallets and back. The second wallet must not inherit the first wallet's balance/recovery record; reload/login never auto-spends.
- [ ] Record exercised evidence separately from unexercised cases, including retained reservations or unsupported storage behavior.

Do not falsify an end-to-end result if no real payer approved a transfer. Report **unpaid smoke passed; paid mainnet step not exercised** where appropriate.

## 9. Repeated updates without breaking identity or contest rules

1. Make the client/verifier changes together. Build new, deliberately named artifacts; replace an existing output only intentionally.
2. Drain/reconcile outstanding paid runs and plan a maintenance window; do not update a live cash-prize contest casually. An app update supersedes the old deployment, and an event pinned to it is not automatically valid for the replacement.
3. Use `rare-profile app update <same-app-id> --zip <new-game.zip> --json`. Keep the existing app ID/origin/group; check that the ZIP still includes its root verifier.
4. Register the replacement's verifier/config and create its own event. Discovery selects only the current deployment. A new event also has its own attempt count; replacing events is not a way to preserve a contest-wide cap automatically.
5. Verify active-event discovery and unpaid connection before permitting a newly confirmed paid start. Never point the new build at an old deployment's event to silence an error.
6. Re-run the approved acceptance subset. Inspect the authoritative shared balance; updates do not reset purchased balances or create packs.

If a browser is still holding an old paid session/run during an update, preserve its keys and reconcile it; do not silently turn it into a fresh paid attempt under the new event. Group membership is app-based; verifier versions and events are deployment-pinned. Cosmetic changes still create a deployment and need correctly pinned scoring setup; mechanics/timing changes additionally require matching verifier/rules and revised contest terms.

## 10. Manual contest results and prize fulfillment

Before announcing a contest, publish clear rules: organizer identity, eligible territories/ages, start/end **with timezone**, included app/event/build IDs, entry cost and whether a pack buys entries, maximum attempts, scoring semantics, ties, bot/multi-wallet policy, outages/updates, disqualification/appeals, prize amounts/assets, funding, claim deadline, recipient verification, taxes and refund/support terms. Obtain appropriate legal/payment review for paid-entry cash prizes. The toolkit is not that review.

Use the [detailed manual review procedure](server-verification.md#7-review-results-before-paying-prizes) for complete event exports, evidence limits, candidate decisions, disqualifications/appeals and recipient verification. Keep original results separate from the organizer's eligibility decision log; no automatic server-run disqualification or payout endpoint is provided by this workflow.

Example: a Target Rush contest can use one event from **2026-11-01 00:00 UTC through 2026-11-08 00:00 UTC**, three attempts per authenticated scoring identity (not per unique human), highest completed server result, and an expressly published tie-break. Color Match can have a separate event and prize. If you want an overall two-game winner, define aggregation/normalization, identity mapping and tie-breaks yourself and audit them; raw scores from different games are not automatically comparable. Replace example dates with your actual future window.

### Read the creator-only completed results feed

```http
GET https://studio.superrare.com/api/v1/games/<app-id>/scoring/events/<event-id>/runs?limit=100&offset=0
Authorization: Bearer <creator-session-jwt>
```

Use the same local-PAT exchange procedure from section 6, then fetch that path with the in-memory JWT. The response has `runs` and `nextOffset`; request successive offsets until `nextOffset` is `null`. Limits are `1`–`100`, offsets `0`–`1000000`. Results contain run/event IDs, player or guest identity references, attempt number, score, ticks, start/end times and evidence hash. They do **not** provide a payout-ready verified-wallet address directory or an eligibility decision. Arrange a consented winner-identification/recipient-verification process rather than guessing addresses from identity IDs.

The feed includes **completed runs only**, sorted by score descending, then end time, then run ID. That ordering does not replace your published tie policy. Active/expired attempts still count against event limits but are not completed results. Inspect event ID and deployment/rules before selecting winners. **There is no finish-after-close grace period:** run expiry is bounded by session expiry, event end and a 10-minute cap, and new finalization at or after expiry/event end is rejected. A last-second entry may not have time to finish. Publish a last-start policy with adequate play/network/recovery margin; the examples do not implement a separate earlier last-start admission cutoff.

The public `GET /api/v1/games/:appId/scoring/top-score` is an app-wide maximum across completed events and deployments. It is **not** an event leaderboard, weekly standings, cross-game ranking or eligibility feed. Community/browser-submitted scores are a different trust path and must not be mixed into official server-result selection.

Credit-sale USDC accumulates in the configured organizer treasury. There is no platform-managed escrow, automatic pooled pot, revenue-to-prize allocation, automated winner calculation, anti-bot adjudication, refund workflow or payout. The organizer funds prizes, reviews winners and pays verified recipients manually with separate explicit wallet approval, then retains receipts and resolves disputes.

### What the server does not prove

The pinned verifier derives score from ordered inputs and server-owned time; the client cannot simply submit an arbitrary official score. That does **not** prove human play, one human per wallet, fair creator rules, exploit-free mechanics or prize eligibility. Targets/colors are visible to the client and can be automated. Input replays are not retained; an evidence hash is not a replay or proof of human skill. Creator-authored conformance is not platform fairness endorsement. Use conservative prizes/rules and manual review; do not market either example as bot-proof.

## 11. Support and safety boundary

For a pause after a payment-term change, an ambiguous retained reservation, verification outage, deployment/verifier failure or missing event, preserve the original identifiers and stop new spending until resolved. An ordinary organizer does not need service-role/database/Privy credentials to publish the two games or inspect their own results. Trusted operator reconciliation remains a support operation; never work around it with ad hoc balance edits, fake claims, copied demo treasuries or extra real transfers.

Keep a deployment/acceptance record that distinguishes **build**, **creator publish**, **unpaid HTTPS smoke**, **explicit payer approval**, **successful purchase claim**, **explicit credit spend**, **server result**, and **manual prize payment**. None implies the next.
