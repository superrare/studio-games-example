import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseConfiguration } from '../src/config.js';
import { packageGame } from './package-game.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { values } = parseArgs({ args: args[0] === '--' ? args.slice(1) : args,
    options: { config: { type: 'string' }, port: { type: 'string', default: '4173' } }, strict: true });
  if (!values.config) throw new Error('Usage: pnpm dev -- --config <public-config.json> [--port 4173]');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer from 1 to 65535.');
  const raw: unknown = JSON.parse(await readFile(resolve(values.config), 'utf8'));
  const configuration = parseConfiguration(raw);
  const files = await packageGame(configuration);
  const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', css: 'text/css; charset=utf-8' };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    const content = Object.hasOwn(files, name) ? files[name] : undefined;
    if (!content || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end(pathname.startsWith('/api/') ? 'Local preview does not proxy Studio scoring APIs. Deploy to the approved game origin for paid play.' : 'Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[name.split('.').at(-1) ?? ''] ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Preview ${configuration.game}: http://127.0.0.1:${port}\nStatic preview only; paid games and one-time sockets require the Studio-approved hosted origin. Restart after source changes.\n`);
  });
  server.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
void main().catch((error: unknown) => {
  process.stderr.write(`Preview failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
