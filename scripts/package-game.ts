import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { strToU8 } from 'fflate';
import { scoringConfiguration, type Configuration } from '../src/config.js';

export type GameFiles = Record<string, Uint8Array>;
const root = fileURLToPath(new URL('../', import.meta.url));

export async function packageGame(configuration: Configuration): Promise<GameFiles> {
  const [browser, verifier, template, stylesheet, license, notice] = await Promise.all([
    build({ absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false, legalComments: 'inline' }),
    build({ absWorkingDir: root, entryPoints: ['src/server-verifier.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false, legalComments: 'inline' }),
    readFile(new URL('../src/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url)),
    readFile(new URL('../LICENSE', import.meta.url)),
    readFile(new URL('../NOTICE', import.meta.url)),
  ]);
  const appBundle = browser.outputFiles[0];
  const verifierBundle = verifier.outputFiles[0];
  if (!appBundle || !verifierBundle) throw new Error('Bundler returned no application or verifier output.');
  if (verifierBundle.contents.byteLength > 256_000) throw new Error('Server verifier exceeds Studio’s 256 KB module limit.');
  const title = configuration.game === 'target-rush' ? 'Target Rush' : 'Color Match';
  const appPath = `assets/app-${createHash('sha256').update(appBundle.contents).digest('hex').slice(0, 16)}.js`;
  const stylePath = `assets/styles-${createHash('sha256').update(stylesheet).digest('hex').slice(0, 16)}.css`;
  const index = template.replace('<head>', `<head>\n    <meta name="play-factory-game-id" content="${configuration.appId}">\n    <link data-rare-app-metadata="true" rel="canonical" href="${configuration.appOrigin}/">`)
    .replace('<title>Studio games · Real shared credits</title>', `<title>${title} · Studio credits</title>`)
    .replace('./assets/app.js', `./${appPath}`)
    .replace('./assets/styles.css', `./${stylePath}`);
  return {
    'index.html': strToU8(index),
    'config.json': strToU8(`${JSON.stringify(configuration, null, 2)}\n`),
    [appPath]: appBundle.contents,
    [stylePath]: stylesheet,
    'server-verifier.js': verifierBundle.contents,
    'scoring-config.json': strToU8(`${JSON.stringify(scoringConfiguration(configuration.game), null, 2)}\n`),
    LICENSE: license,
    NOTICE: notice,
  };
}
