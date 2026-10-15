# Cloudline Arcade

Two original browser games share one Studio credit group through the published **`@rareprotocol/connect@0.9.0-beta.0`** SDK:

- **Sky Hopper:** Flappy Bird-style obstacle flight.
- **Star Runner:** an original platformer with three levels.

Each game has a separate Studio app and HTTPS origin; both attach to the same wallet balance. Each play costs **1 credit**. The configured purchase pack is **$0.10 USDC for 10 credits** on Ethereum mainnet. Network fees are separate and may exceed the pack price.

These are real payment integrations, not demos or faucets. Sign-in, purchases, and paid starts remain separate explicit actions. Only the completed result from the pinned server verifier is official. Deterministic server rules prevent browser score forgery; they cannot prove that a valid player input came from a human. Bots, multi-wallet abuse, and contest eligibility need separate controls and manual organizer review. Do not describe these games as bot-proof.

## Setup

Requirements: Node.js 22+, Git, and pnpm 10.11.0.

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Read the [organizer runbook](docs/organizer-runbook.md) before registering a game or treasury. You must own or be authorized to register both Studio apps, have their final HTTPS origins, and choose a treasury you control. The safe setup preview performs no remote command, file write, deployment, or payment:

```sh
pnpm setup:group -- --treasury <controlled-ethereum-address> --slug <unique-group-slug> \
  --flappy-app <app-uuid> --flappy-origin https://<flappy-host> \
  --platformer-app <app-uuid> --platformer-origin https://<platformer-host>
```

Review the displayed mainnet commands, app identities, origins, and treasury. Append `--apply` only when you intend to create the live-capable group and immediately register both apps. Registration gates ordinary unpaid starts on those apps. The script verifies 100000 atomic USDC / 10 credits and 1 credit per app; it does not deploy apps, publish scoring events, purchase credits, or authorize wallet transfers. It writes ignored `flappy-bird.config.json` and `platformer.config.json` files. Preserve the returned group ID; do not blindly rerun after a partial CLI failure.

Build the two artifacts:

```sh
pnpm build -- --config ./flappy-bird.config.json --output ./dist/flappy-bird.zip
pnpm build -- --config ./platformer.config.json --output ./dist/platformer.zip
```

The example configurations under `examples/` contain placeholders and are not deployable. Each ZIP has `index.html`, `config.json`, hashed `assets/`, root `server-verifier.js`, and variant-matched `scoring-config.json`. Defaults are 1400/1200 ticks for Sky Hopper and 2600/2400 ticks for Star Runner. Building does not publish an app or enable scoring; follow the runbook to update the allocated apps and publish a deployment-pinned verifier/event.

For a static local preview, use either generated config:

```sh
pnpm dev -- --config ./flappy-bird.config.json
# or: pnpm dev -- --config ./platformer.config.json --port 4173
```

Local HTTP cannot exercise official paid starts or server sockets. Never treat preview scores as official.

## Verification and operations

The platform owns player identity, credit authorization, paid-run admission, input ordering, server time, verifier state, and final score. The browser sends only strict game inputs; the Worker derives movement, collisions, level progress, and points from server-owned state. Public snapshots omit the private random generator state. Game code and score-critical rules are deterministic and bounded.

Read [server verification and abuse limits](docs/server-verification.md) before prize use. Server verification makes score tampering harder, not legal automation impossible: a bot can still send valid inputs, and a wallet does not establish one unique human. Use conservative stakes, published contest rules, independent review, and manual winner/payout decisions.

## Current Studio deployment

Both apps are deployed at their permanent HTTPS origins and registered in one shared mainnet credit group:

- **Sky Hopper:** app `f89bd492-1479-46ff-b455-1ec479e45684` · [tu9zzywe.srstudio.dev](https://tu9zzywe.srstudio.dev) · current deployment `f2698cec-1ac6-421a-98d3-484c968a9962` · event `146272af-4938-4ef7-8ddf-77ec6badbbdd`.
- **Star Runner:** app `7d0a34a0-ca86-413a-871c-7b731adf4511` · [q77e66pg.srstudio.dev](https://q77e66pg.srstudio.dev) · current deployment `ea39fb1d-adfe-4e9a-8db3-6729a43ad9cf` · event `7d6d0f8d-98db-46ec-aae9-1140e2392ba9`.

Group `8020b761-b30e-41a5-9f14-8c82728cfdb2` is configured for canonical Ethereum USDC at **$0.10 / 10 credits**, with each app costing **1 credit per play**. Both authenticated server-scoring events are active with a 20-attempt per-identity limit. Sign-in and hosted wallet checkout open in embedded Connect modals. The group and event setup is live-capable, but no wallet purchase or paid gameplay was exercised. Buying credits transfers real USDC to the configured treasury; don't purchase merely to inspect the games. Local app configs are ignored and contain the shared group binding.

The public leaderboard is app-level; it is not a combined-game ranking or contest result. Bot-resistance and manual prize-review limits are described above and in the [verification guide](docs/server-verification.md).

## License

MIT; see [LICENSE](LICENSE).
