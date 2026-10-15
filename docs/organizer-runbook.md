# Organizer runbook: two games, one purchased-credit balance

This guide publishes **Target Rush** and **Color Match** from [the public example](https://github.com/superrare/studio-games-example). It separates creator deployment permissions from the player's wallet approvals. No database access, service-role key, provisioning secret or Privy application secret belongs in an ordinary organizer's workflow or game bundle.

The supported production payment setup here is **Ethereum mainnet only** (`chainId: 1`), canonical Ethereum USDC (`0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`), **0.01 USDC for 10 credits**, and **1 credit per play**. USDC has six decimals, so the pack costs `10000` atomic units. Network fees are separate; 0.01 USDC is not a gas limit or total-cost guarantee.

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

Use Node.js **22+** and pnpm **10.11.0** for this example. The CLI declares Node 20+, but using Node 22+ satisfies both projects. You also need Git and a ZIP utility for the small bootstrap below.

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
git clone https://github.com/superrare/studio-games-example.git
cd studio-games-example
pnpm install
```

The repository pins the published **`@rareprotocol/connect@0.9.0-beta.0`** npm prerelease and its lockfile, not an unpublished SDK checkout. The SDK supplies popup sign-in, group credits, explicit consent/recovery, server-run start and public authoritative scoring reads. These examples call `getActiveScoringEvent()` and `getServerLeaderboard()` through a client pointed at the deployed game's own origin; community leaderboards are not a substitute for server results. Sign in with `auth.login()` before the API-only `game.connect()` authorization step. Native embedding is available in this beta but is deliberately not enabled in these popup examples.

### Current rare-profile release reality

The feature-enabled CLI reports **`0.1.0-beta.4`**. At the 2026-10-15 release check, npm `latest` and `beta` still pointed to beta.3. Do not assume `npm install -g @rareprotocol/rare-profile` supplies group commands. Until npm publishes the merged feature release, install from the public merged commit **`4a9edb3deb63b0941e34748561d39245ac41a74a`**:

```sh
git clone https://github.com/superrare/rare-profile.git /tmp/rare-profile-game-setup
git -C /tmp/rare-profile-game-setup checkout --detach 4a9edb3deb63b0941e34748561d39245ac41a74a
pnpm --dir /tmp/rare-profile-game-setup install --frozen-lockfile
pnpm --dir /tmp/rare-profile-game-setup build
(cd /tmp/rare-profile-game-setup && npm pack)
npm install --global /tmp/rare-profile-game-setup/rareprotocol-rare-profile-0.1.0-beta.4.tgz
rare-profile --version
rare-profile --help
rare-profile credit-group --help
```

Use an unused checkout directory if that path already exists. The source build is the installation workaround, not a requirement for a private package registry. `app deploy --help` is not reliable subcommand help in this CLI: it can run validation and report missing deployment flags. Use the exact commands below.

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

The normal CLI credential file is `~/.rare-profile/config.json`, containing a personal access token and `baseUrl`. Keep it private. It is creator deployment access, **not** a player Connect session, wallet key or permission to spend USDC.

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
  --usdc 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 \
  --pack-price-atomic 10000 \
  --pack-credits 10 \
  --json
```

Record `data.group.id`. Inspect before attaching apps:

```sh
rare-profile credit-group get <group-id> --json
rare-profile credit-group list --json
```

Confirm chain `1`, canonical USDC, your treasury, `packPriceAtomic: "10000"`, `packCredits: 10`, `purchasesPaused` and `newUsesPaused`. New groups should show purchases unpaused; if using an existing group, do not assume the migration changed it.

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

### Payment-term changes still have an operational limitation

Changing treasury, token, pack price or pack quantity creates a new immutable payment configuration and automatically pauses purchases. The group's chain is immutable. Existing balances and historical quotes are not reset. The public CLI currently has `create`, `list`, `get`, and `add-game`; it has **no purchase-unpause command**. An already paused group, including a group paused by a payment-term change, still needs a trusted Studio operator's recovery procedure after terms are checked. This is a self-service administration gap, **not organizer approval**, and it does not justify sharing database/service-role access with the organizer. `newUsesPaused` is separate from the purchase pause. Escalate a pause or ambiguous reservation to support with identifiers, not secrets; do not repeatedly create replacement groups.

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
  "display": "popup",
  "game": "target-rush"
}
```

Use `game: "color-match"`, the Color Match app ID and its exact origin in the second file; use the **same group ID**. Optionally set `siblingUrl` to the other game's HTTPS URL. These are public routing/identity values, not credentials. Do not put treasury overrides, private keys, PATs, JWTs, session tokens or Privy secrets here. The player sees payment terms from the authoritative Studio quote.

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

The deployed game owns visible UI and recovery records, not the credit ledger. Never replace these steps with an arbitrary USDC transfer or a browser-submitted score.

1. **Sign in explicitly.** Connect's popup handles identity/wallet interaction. The app exchanges the Connect credential for a short-lived `GameAuthorization` bound to wallet, group, app and exact origin. Login/connection must not buy, reserve or start a play. Reuse valid sessions, and discard cached authorizations when the account changes.
2. **Choose a purchase explicitly.** Show the current offer and balances. Create an account-bound quote *before* transferring. Persist the quote, wallet/scope, snapshotted terms and expiry. Confirm chain `1`, canonical USDC, quoted treasury and atomic amount. The player reviews the **10 credits / 0.01 USDC plus gas** choice in the hosted flow; they separately approve any real wallet action. The quote's wallet must be the payer.
3. **Claim the payment.** Preserve the hosted transfer intent ID before opening checkout, then the returned transaction hash. The published transfer API uses `currency: "USDC"` and an atomic-unit amount string. Only Studio's successful claim of that exact quote/hash and authoritative balance establish that credits exist; wallet success UI alone does not. A qualifying payment normally must be mined within the quote's 30-minute window and above its snapshotted lower block bound. Earlier qualifying payments can be claimed after expiry/purchase pause. Canonical inclusion is checked at the current head, not finalized settlement; later reorgs are not automatically reversed.
4. **Confirm each credit spend explicitly.** Fetch current terms, show **Play — spend 1 credit** (or the returned actual cost), and request one-use consent only after that choice. Persist the attempt key, fingerprint, expected cost, original start fields and consent before paid start. Studio reserves the cost and captures the debit once initialization succeeds. A valid paid `PlaySession` admits one server-managed round, not a free-session fallback or multiple adapters.
5. **Run and finish on the server.** Resolve the event on the game's own origin, save a separate server-run key, and start with the paid PlaySession. The response provides a same-origin WebSocket URL with a one-time ticket. The browser sends ordered player inputs, not score/state/time. Target Rush uses server-issued targets; Color Match uses server-issued desired colors and wrong choices must not score. Only the server's terminal result is official. Complete the paid PlaySession after terminal confirmation and recover completion for that same session if necessary.

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

- [ ] Clone and install using only the published browser dependency; build each game with its own config and no SDK checkout.
- [ ] Confirm both ZIPs have the required root client/config/verifier/scoring artifacts and different game variants.
- [ ] Check app IDs/origins against CLI deployment responses; check both approved registrations cost `1` in the same group.
- [ ] Inspect chain, USDC, controlled treasury, `10000`/`10`, purchase pause and new-use pause states before showing a purchase button.
- [ ] Update both original app IDs; publish each current deployment's matching verifier/event and verify its active-event endpoint.
- [ ] Open each deployed HTTPS page. Check controls, game variant and errors. No transfer, claim, consent, reservation or run should begin on page load/reload.
- [ ] Click Connect and verify popup sign-in works on the registered origin. Connecting alone changes neither balance nor transaction history. A fresh wallet reads zero; do not grant test credits to manufacture success.
- [ ] Open/cancel a purchase UI before wallet approval if testing cancellation; opening or quoting is not a successful purchase. Preserve any pending quote/intent information.
- [ ] Confirm disabled play/no active-event/insufficient-credit cases explain the issue instead of using an unpaid fallback or local official score.

These checks can establish deployment/auth/configuration, **not** successful paid acceptance. Do not say that a built ZIP or a successful creator API request proves payment or gameplay.

### Explicit real-mainnet wallet step

This is optional until the payer explicitly approves it. Agree on **one 0.01-USDC pack on Ethereum plus gas**, the exact controlled recipient, and **one credit per explicitly confirmed play**. Creator CLI access is not this approval. Never automate a transfer or credit grant as part of deployment.

- [ ] The payer clicks Buy in Target Rush, reviews the current quote/recipient/chain and explicitly approves the hosted wallet action. Record purchase ID and transaction hash without logging secrets.
- [ ] Claim that quote and confirm the authoritative available balance increases by **10**, exactly once. Repeating the same successful claim must not grant a second pack. Do not submit a second transfer to test idempotency.
- [ ] Confirm **Play — spend 1 credit** once in Target Rush. Finish a real server-scored round; balance should fall by **1**, not by repeated clicks or response retries. Confirm a server result and completion.
- [ ] Open Color Match on its different origin and connect the **same wallet**. It should read the same group's remaining balance without another purchase.
- [ ] Explicitly confirm one Color Match play. Try a wrong color and verify no point is earned, then a correct server-requested color. Finish with a server result. Both games should now report the same balance, normally **8 available** from a fresh 10-credit pack with no other operations/reservations.
- [ ] Exercise saved quote/claim and paid-start/server-run recovery without generating a fresh payment or idempotency key. Confirm the original operation, not an extra charge/run, is recovered.
- [ ] Switch wallets and back. Verify the second wallet does not inherit the first wallet's balance/recovery record and that reload/login never auto-spends.
- [ ] Record exercised evidence separately from unexercised cases, including any retained reservation or unsupported browser-storage behavior.

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
