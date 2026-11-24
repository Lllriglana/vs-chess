# Third-party notices

## Stockfish 19 Lite WASM

Copyright the Stockfish developers and Chess.com, LLC. The Lite network is credited to sscg13. See [Stockfish authors](licenses/Stockfish-AUTHORS.txt). Targeted WebAssembly port by Nathan Rugg and contributors.

The distributed loader and WebAssembly file are unmodified assets from the Stockfish.js v19.0.1 release, commit `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6`. The binary distribution is covered by the GNU General Public License version 3. Upstream source headers also permit later versions. [Stockfish.js v19.0.1 release](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1) · [Stockfish GPL text](licenses/Stockfish-GPL-3.0.txt)

The VSIX contains the release source archive, build scripts, Emscripten glue, and the matching `nn-61e7af4bb97d.nnue` network in `corresponding-source/`. To rebuild the Lite single-threaded artifact, unpack `stockfish-19-source.tar.gz`, copy the network into the unpacked `src/` folder, set up Emscripten as described in the upstream README, and run the command below from the unpacked directory. The Lite build uses only the included network. [Upstream source and build documentation](https://github.com/nmrugg/stockfish.js/tree/v19.0.1) · [Matching network](https://tests.stockfishchess.org/api/nn/nn-61e7af4bb97d.nnue)

```sh
node build.js --lite --single-threaded --no-split
```

## chess.js 1.4.0

Copyright Jeff Hlywa. The BSD 2-Clause notice is included. The VSIX contains the library's TypeScript and parser source under `corresponding-source/chess.js/`. [chess.js release](https://github.com/jhlywa/chess.js/releases/tag/v1.4.0) · [chess.js license](licenses/chess.js-BSD-2-Clause.txt)

## VS Chess sources and redistribution

The VSIX includes the TypeScript, stylesheet, original artwork, manifests, and build scripts. To inspect them, extract the VSIX as a ZIP archive and open its `extension/` directory. Build with `npm ci` and `npm run build`.

Preserve copyright notices and license texts when redistributing. Provide the corresponding source for the exact binaries you distribute in accordance with the GPL. If you modify the GPL-covered code, preserve the required notices, identify the changes, and supply the modified corresponding source. [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.html)
