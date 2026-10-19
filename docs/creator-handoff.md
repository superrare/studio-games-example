# One-off arcade creator handoff

Organizer: replace `<SHARED_GROUP_ID>` below with the existing arcade group UUID before forwarding. This pilot uses 1 credit per play; confirm that with the creator before registration.

---

We're testing games that use one shared arcade credit balance. You build and publish your game under your own Studio account; I'll connect it to the arcade when it's ready.

**Use this existing credit group:** `<SHARED_GROUP_ID>`

## Build your game

1. Start from [the Studio games example](https://github.com/superrare/studio-games-example). Use one game as your starting point; you do not need to publish both examples. Keep the credit integration, explicit player consent, and server-verified scoring flow. When changing game rules, keep the client and server verifier consistent.
2. Use your own creator account. Create one stable app ID and HTTPS origin with the bootstrap process in the [organizer runbook](organizer-runbook.md#3-allocate-stable-app-identities-with-unpaid-bootstraps); its two-app commands are for the two-game example, so run the deploy command once for your game. Use an unmistakably test-only title and record the returned app ID and URL.
3. Make one public config based on the matching example JSON. Set `appId` to your app ID, `groupId` to the one above, and `appOrigin` to your exact deployed HTTPS origin. Keep the Studio/API/Connect URLs, choose the matching `game` variant, and do not add payment secrets.
4. **Skip creating a credit group.** Build your customized game with the config and update the same app, as shown in the runbook's [build and update section](organizer-runbook.md#5-build-and-update-the-same-two-apps). Publish its matching verifier and scoring event using the runbook.
5. Check the deployed page and local Practice. Paid play will not be ready until I register the app.

## Send me this when ready

```text
Creator:
App ID:
Deployed HTTPS origin:
I agree to enable this app in the shared arcade group at 1 credit per play.
```

I'll register it, reply when enabled, and coordinate a play check. Do not buy credits or send money merely to verify deployment. Never send me your CLI token, wallet key, or session credentials.

---

## Organizer-only step — do not ask creators to run this

After confirming creator consent and integration readiness:

```sh
rare-profile credit-group add-game <SHARED_GROUP_ID> \
  --app <CREATOR_APP_ID> \
  --origin https://<CREATOR_APP_HOST> \
  --credits 1

rare-profile credit-group get <SHARED_GROUP_ID> --json
```

Use the exact origin without a path or trailing slash. Registration on an active group immediately gates ordinary unpaid starts. Do not register a live app before its paid-play integration is ready. Review the deployed flow without initiating payment; coordinate any real paid test separately. Registration does not establish creator revenue sharing or automatic payouts.
