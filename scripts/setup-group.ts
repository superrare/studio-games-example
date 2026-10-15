import { spawn } from 'node:child_process';
import { lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { configurationSchema, parseConfiguration, type Configuration } from '../src/config.js';

const STUDIO = 'https://studio.superrare.com';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const root = fileURLToPath(new URL('../', import.meta.url));
const usage = `Usage: pnpm setup:group -- --treasury <controlled-ethereum-address> --slug <unique-group-slug>
  --flappy-app <app-uuid> --flappy-origin <exact-https-origin>
  --platformer-app <app-uuid> --platformer-origin <exact-https-origin> [--dry-run | --apply]

Dry-run is the default: no CLI execution, remote changes, or local writes.
--apply creates a live-capable mainnet group and registers exactly the two supplied apps.
Registration gates unpaid starts immediately. Use only apps you control or have permission to register.
Review the treasury independently: subsequent purchases send real USDC there.
No wallet payment, credit purchase, deployment, or scoring-event request is made.
Requires the feature-enabled rare-profile CLI and an existing creator login (see organizer runbook).
Outputs: flappy-bird.config.json and platformer.config.json in this repository (ignored; never overwritten).`;

type App = { game: Configuration['game']; appId: string; origin: string; output: string };
// CLI envelopes and fields are pinned to rare-profile commit 4a9edb3deb63b0941e34748561d39245ac41a74a:
// src/cli/{output.ts,commands/credit-group.ts} and src/sdk/types.ts, as documented in the runbook.
const appSchema = z.object({ productId: z.string().uuid(), origin: z.string(), creditCost: z.number().int() });
const groupSchema = z.object({
  id: z.string().uuid(), slug: z.string(), displayName: z.string(), chainId: z.number().int(),
  treasuryAddress: z.string(), usdcAddress: z.string(), packPriceAtomic: z.string(), packCredits: z.number().int(),
  purchasesPaused: z.boolean(), newUsesPaused: z.boolean(), paymentConfigId: z.string().nullable(),
  apps: z.array(appSchema),
});
const envelopeSchema = z.object({ ok: z.literal(true), command: z.literal('credit-group'), data: z.unknown() });
type Group = z.infer<typeof groupSchema>;

function command(args: string[]): string[] {
  return ['credit-group', ...args, '--base-url', STUDIO, '--json'];
}

function printCommand(args: string[]): void {
  process.stdout.write(`rare-profile ${args.map((value) => `'${value.replaceAll("'", "'\\''")}'`).join(' ')}\n`);
}

async function runCli(args: string[]): Promise<unknown> {
  printCommand(args);
  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn('rare-profile', args, { shell: false, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) reject(new Error(`rare-profile failed (${signal ?? code}). No automatic retry was attempted.`));
      else resolveOutput(stdout);
    });
  });
  return envelopeSchema.parse(JSON.parse(output)).data;
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing existing output: ${path}. Choose a fresh checkout or preserve and move your existing configs yourself.`);
}

function validateTerms(group: Group, treasury: string, slug: string, groupId: string): void {
  if (group.id !== groupId || group.slug !== slug || group.chainId !== 1
    || group.treasuryAddress.toLowerCase() !== treasury || group.usdcAddress.toLowerCase() !== USDC
    || group.packPriceAtomic !== '100000' || group.packCredits !== 10 || !group.paymentConfigId) {
    throw new Error('Returned group identity or mainnet payment terms do not match the requested setup.');
  }
  if (group.purchasesPaused || group.newUsesPaused) {
    throw new Error('Returned group is paused. Inspect it with rare-profile credit-group get; no pause override is available here.');
  }
}

function validateApps(group: Group, apps: App[]): void {
  if (group.apps.length !== apps.length || apps.some((expected) =>
    group.apps.filter((app) => app.productId.toLowerCase() === expected.appId
      && app.origin === expected.origin && app.creditCost === 1).length !== 1)) {
    throw new Error('Group registrations do not match exactly the expected apps, origins, and 1-credit play costs.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { values } = parseArgs({ args: args[0] === '--' ? args.slice(1) : args, strict: true, options: {
    treasury: { type: 'string' }, slug: { type: 'string' },
    'flappy-app': { type: 'string' }, 'flappy-origin': { type: 'string' },
    'platformer-app': { type: 'string' }, 'platformer-origin': { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, apply: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) { process.stdout.write(`${usage}\n`); return; }
  if (values.apply && values['dry-run']) throw new Error('Choose --apply or --dry-run, not both.');
  if (!values.treasury || !values.slug || !values['flappy-app'] || !values['flappy-origin']
    || !values['platformer-app'] || !values['platformer-origin']) throw new Error(usage);

  const treasury = values.treasury.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(treasury) || /^0x([0-9a-f])\1{39}$/.test(treasury)
    || /^0x0{36}[0-9a-f]{4}$/.test(treasury)) {
    throw new Error('Supply a real controlled Ethereum treasury, not a zero, burn, sentinel, or example address.');
  }
  const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(64).parse(values.slug);
  const makeApp = (game: App['game'], appId: string, origin: string): App => {
    const validatedOrigin = configurationSchema.shape.appOrigin.parse(origin);
    const hostname = new URL(validatedOrigin).hostname;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || !hostname.includes('.')) {
      throw new Error('App registrations require public HTTPS origins, not localhost.');
    }
    return { game, appId: configurationSchema.shape.appId.parse(appId).toLowerCase(),
      origin: validatedOrigin, output: resolve(root, `${game}.config.json`) };
  };
  const apps: [App, App] = [makeApp('flappy-bird', values['flappy-app'], values['flappy-origin']),
    makeApp('platformer', values['platformer-app'], values['platformer-origin'])];
  if (apps[0].appId === apps[1].appId || apps[0].origin === apps[1].origin) {
    throw new Error('Supply two distinct app UUIDs and two distinct app origins.');
  }
  // All input and output-path validation precedes CLI execution or filesystem writes.
  await Promise.all(apps.map((app) => assertMissing(app.output)));
  const create = command(['create', '--slug', slug, '--name', 'Cloudline Arcade shared credits',
    '--chain-id', '1', '--treasury', treasury, '--usdc', USDC, '--pack-price-atomic', '100000', '--pack-credits', '10']);

  if (!values.apply) {
    process.stdout.write('DRY RUN: no commands executed or files written. Replace <created-group-id> below with create response data.group.id.\n');
    printCommand(create);
    printCommand(command(['get', '<created-group-id>']));
    for (const app of apps) printCommand(command(['add-game', '<created-group-id>', '--app', app.appId,
      '--origin', app.origin, '--credits', '1']));
    printCommand(command(['get', '<created-group-id>']));
    process.stdout.write('Apply verifies canonical USDC, treasury, 100000 atomic / 10 credits, unpaused state, and exactly both 1-credit registrations.\n');
    for (const app of apps) process.stdout.write(`Would write ${app.output} (${app.game}, sibling ${apps.find((other) => other !== app)!.origin}).\n`);
    process.stdout.write('Review all identifiers and treasury ownership, then repeat with --apply to create and register. No payment is requested.\n');
    return;
  }

  let groupId: string | undefined;
  try {
    const created = await runCli(create);
    groupId = z.object({ group: z.object({ id: z.string().uuid() }) }).parse(created).group.id;
    process.stdout.write(`Created group: ${groupId}. Preserve this ID; do not repeat creation after a partial failure.\n`);
    validateTerms(groupSchema.parse(z.object({ group: z.unknown() }).parse(created).group), treasury, slug, groupId);
    const readGroup = async (): Promise<Group> => {
      const data = z.object({ group: groupSchema }).parse(await runCli(command(['get', groupId!])));
      validateTerms(data.group, treasury, slug, groupId!);
      return data.group;
    };
    validateApps(await readGroup(), []);
    for (const app of apps) {
      const registration = z.object({ groupId: z.string().uuid(), app: appSchema }).parse(await runCli(command([
        'add-game', groupId, '--app', app.appId, '--origin', app.origin, '--credits', '1',
      ])));
      if (registration.groupId !== groupId || registration.app.productId.toLowerCase() !== app.appId
        || registration.app.origin !== app.origin || registration.app.creditCost !== 1) {
        throw new Error('CLI registration response does not match the requested app, origin, or credit cost.');
      }
    }
    validateApps(await readGroup(), apps);
    const configs = apps.map((app, index) => parseConfiguration({
      appId: app.appId, groupId, studioUrl: STUDIO, apiUrl: 'https://api.superrare.com',
      connectUrl: 'https://connect.superrare.com', appOrigin: app.origin, display: 'embed', game: app.game,
      siblingUrl: apps[index === 0 ? 1 : 0].origin,
    }));
    for (const [index, app] of apps.entries()) {
      await writeFile(app.output, `${JSON.stringify(configs[index], null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(`Wrote ${app.output}\n`);
    }
    process.stdout.write(`Verified shared group ${groupId}: $0.10 USDC / 10 credits, 1 credit per play, exactly two apps. No payment requested.\n`);
  } catch (error) {
    if (groupId) process.stderr.write(`Setup stopped for group ${groupId}. Remote changes and any written configs are preserved. Inspect with rare-profile credit-group get ${groupId} --json; do not rerun --apply blindly.\n`);
    else process.stderr.write('Creation may have an unknown outcome. Inspect rare-profile credit-group list --json before retrying; no automatic retry was attempted.\n');
    throw error;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Group setup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
