import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: {
    publisher: { type: 'string' },
    repository: { type: 'string' },
    ref: { type: 'string' }
  }
});
const publisher = values.publisher;
if (publisher !== undefined && !/^[a-z0-9][a-z0-9-]*$/i.test(publisher)) {
  throw new Error('Provide your Marketplace publisher ID with --publisher.');
}
const repository = values.repository && new URL(values.repository);
if (repository && (repository.protocol !== 'https:' || !['github.com', 'gitlab.com'].includes(repository.hostname)
  || repository.username || repository.password || repository.search || repository.hash)) {
  throw new Error('Provide the public GitHub or GitLab repository URL with --repository.');
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('work', { recursive: true });
const root = await mkdtemp('work/package-');
const sources = `${root}/corresponding-source`;
await mkdir(sources, { recursive: true });
await mkdir('outputs', { recursive: true });

const sourceFiles = [
  {
    name: 'stockfish-19-source.tar.gz',
    url: 'https://codeload.github.com/nmrugg/stockfish.js/tar.gz/refs/tags/v19.0.1',
    hash: 'a18aa8a871f5265014b110b3e07804ff3637899d2e189be6ded2b99e2c17a10e'
  },
  {
    name: 'nn-61e7af4bb97d.nnue',
    url: 'https://tests.stockfishchess.org/api/nn/nn-61e7af4bb97d.nnue',
    hash: '61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b'
  }
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function materialize({ name, url, hash }) {
  const cache = `work/${name}`;
  let bytes = await readFile(cache).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!bytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) === hash) await writeFile(cache, bytes);
  }
  if (sha256(bytes) !== hash) throw new Error(`Unexpected SHA-256 for ${cache}`);
  await writeFile(`${sources}/${name}`, bytes);
}
for (const [file, hash] of [
  ['js', 'ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a'],
  ['wasm', 'ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de']
]) {
  if (sha256(await readFile(`dist/stockfish-19-lite-single.${file}`)) !== hash) {
    throw new Error(`Stockfish ${file} differs from the pinned upstream release`);
  }
}
await Promise.all([
  ...sourceFiles.map(materialize),
  ...['dist', 'src', 'licenses', 'scripts', 'media', 'test', 'data'].map(dir => cp(dir, `${root}/${dir}`, { recursive: true })),
  ...['README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'tsconfig.json',
    '.vscodeignore', 'package-lock.json'].map(file => copyFile(file, `${root}/${file}`))
]);
const chessSource = `${sources}/chess.js`;
await mkdir(chessSource, { recursive: true });
await Promise.all([
  cp('node_modules/chess.js/src', `${chessSource}/src`, { recursive: true }),
  ...['LICENSE', 'package.json', 'README.md', 'peggy.config.mjs', 'rollup.config.mjs', 'tsconfig.cjs.json',
    'tsconfig.esm.json', 'tsconfig.types.json', 'tsconfig.json'].map(file =>
      copyFile(`node_modules/chess.js/${file}`, `${chessSource}/${file}`))
]);

// The local package uses vsce's unpublished mode. Only release packaging supplies a publisher.
if (publisher) manifest.publisher = publisher;
const linkOptions = ['--allow-missing-repository', '--no-rewrite-relative-links'];
if (repository) {
  manifest.repository = { type: 'git', url: repository.href };
  const flag = repository.hostname === 'github.com' ? '--githubBranch' : '--gitlabBranch';
  linkOptions.splice(0, linkOptions.length, flag, values.ref ?? `v${manifest.version}`);
}
await writeFile(`${root}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
const cli = require.resolve('@vscode/vsce/package.json');
const vsce = resolve(cli, '../vsce');
const destination = resolve('outputs', `${manifest.name}-${manifest.version}${publisher ? '' : '-local'}.vsix`);
const result = spawnSync(process.execPath,
  [vsce, 'package', '--no-dependencies', ...linkOptions, '--out', destination],
  { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
