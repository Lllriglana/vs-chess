import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Game } from '../src/chess/game';
import { Stockfish } from '../src/engine/stockfish';
import { defaults } from '../src/shared/protocol';

const engine = new Stockfish(resolve('node_modules/stockfish/bin/stockfish-19-lite-single.js'));

test('actual Stockfish searches at every difficulty and returns a playable move', { timeout: 15_000 }, async () => {
  const game = new Game({ mode: 'computer', color: 'b', control: 'off' });
  const abort = new AbortController();
  for (let level = 0; level < 6; level++) {
    const move = await engine.search(game.enginePosition(), { ...defaults, level, thinkMs: 100 }, abort.signal);
    assert.equal(game.play(move, 0), true);
  }
  assert.equal(game.enginePosition().moves.length, 6);
});

test('cancelling an active search terminates its process and leaves the next search independent', { timeout: 8000 }, async () => {
  const game = new Game({ mode: 'computer', color: 'b', control: 'off' });
  const abort = new AbortController();
  const pending = engine.search(game.enginePosition(), { ...defaults, thinkMs: 3000 }, abort.signal);
  const timer = setTimeout(() => abort.abort(), 160);
  await assert.rejects(pending, { name: 'AbortError' });
  clearTimeout(timer);
  const fresh = await engine.search(game.enginePosition(), { ...defaults, thinkMs: 100 }, new AbortController().signal);
  assert.equal(game.play(fresh, 0), true);
});
