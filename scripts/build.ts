import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { zipSync } from 'fflate';
import { parseConfiguration } from '../src/config.js';
import { packageGame } from './package-game.js';

async function main(): Promise<void> {
  const packageDefinition = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const args = process.argv.slice(2);
  const { values } = parseArgs({ args: args[0] === '--' ? args.slice(1) : args,
    options: { config: { type: 'string' }, output: { type: 'string' }, force: { type: 'boolean', default: false } }, strict: true });
  if (!values.config || !values.output) throw new Error('Usage: pnpm build -- --config <public-config.json> --output <game.zip> [--force]');
  const raw: unknown = JSON.parse(await readFile(resolve(values.config), 'utf8'));
  const configuration = parseConfiguration(raw);
  const output = resolve(values.output);
  let exists = false;
  try { await access(output); exists = true; } catch { /* A new output is expected. */ }
  if (exists && !values.force) throw new Error(`Output exists: ${output}. Use another path or --force.`);
  const files = await packageGame(configuration);
  const archive = zipSync(files, { level: 9 });
  if (archive.byteLength > 50_000_000) throw new Error('Archive exceeds Studio’s 50 MB limit.');
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, archive, { flag: 'wx' });
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  process.stdout.write(`Game: ${configuration.game}\nArchive: ${output}\nConnect dependency: ${packageDefinition.dependencies?.['@rareprotocol/connect'] ?? 'missing'}\nSHA-256: ${createHash('sha256').update(archive).digest('hex')}\nSize: ${archive.byteLength} bytes\n`);
}
void main().catch((error: unknown) => {
  process.stderr.write(`Build failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
