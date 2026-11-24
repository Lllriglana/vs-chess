import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await Promise.all([
  build({
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'dist/extension.cjs',
    bundle: true,
    external: ['vscode'],
    platform: 'node',
    target: 'node20',
    minify: true
  }),
  build({
    entryPoints: ['src/ui/app.ts'],
    outfile: 'dist/webview.js',
    bundle: true,
    platform: 'browser',
    target: 'chrome128',
    minify: true
  }),
  copyFile('src/themes/webview.css', 'dist/webview.css'),
  ...['js', 'wasm'].map(ext => {
    const file = `stockfish-19-lite-single.${ext}`;
    return copyFile(`node_modules/stockfish/bin/${file}`, `dist/${file}`);
  })
]);
