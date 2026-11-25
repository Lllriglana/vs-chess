import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Review } from '../src/analysis/review';
import { Game } from '../src/chess/game';
import { Stockfish } from '../src/engine/stockfish';
import { formatEvaluation } from '../src/shared/analysis';
import { defaults, parseAction, parseResponse } from '../src/shared/protocol';

const e4 = { from: 'e2', to: 'e4' } as const;
const e5 = { from: 'e7', to: 'e5' } as const;

function finishedGame() {
  const game = new Game({ mode: 'local', color: 'w', control: '3+2' });
  assert.ok(game.play(e4, 0));
  assert.ok(game.play(e5, 0));
  assert.ok(game.resign(0));
  return game;
}

test('review previews a variation without touching the finished game', () => {
  const game = finishedGame();
  const snapshot = game.save(0);
  const review = new Review(snapshot, game.view(defaults, 0, false, false));
  assert.equal(review.ply, 1);
  assert.deepEqual(review.history, ['e4', 'e5']);
  review.accept([{ depth: 10, score: { kind: 'cp', value: 37 }, moves: ['c7c5', 'g1f3'] }]);
  assert.deepEqual(review.info().lines[0], {
    depth: 10, score: { kind: 'cp', value: -37 }, moves: ['c5', 'Nf3'],
    inputs: [
      { from: 'c7', to: 'c5', promotion: undefined },
      { from: 'g1', to: 'f3', promotion: undefined }
    ]
  });
  assert.ok(review.show(0, 2));
  assert.equal(review.view(defaults, 0).pieces.f3?.type, 'n');
  assert.equal(review.view(defaults, 0).clock, undefined);
  assert.ok(review.seek(1));
  assert.equal(review.view(defaults, 0).pieces.f3, undefined);
  assert.equal(review.info().status, 'ready');
  assert.ok(review.seek(2));
  assert.equal(review.view(defaults, 0).pieces.e5?.type, 'p');
  assert.deepEqual(game.save(0), snapshot);
});

test('Stockfish returns three continuations that can be previewed', { timeout: 12_000 }, async () => {
  const game = finishedGame();
  const review = new Review(game.save(0), game.view(defaults, 0, false, false));
  const engine = new Stockfish(resolve('node_modules/stockfish/bin/stockfish-19-lite-single.js'));
  const lines = await engine.analyze(review.enginePosition, new AbortController().signal);
  assert.equal(lines.length, 3);
  assert.equal(new Set(lines.map(line => line.moves[0])).size, 3);
  review.accept(lines);
  for (const [index, line] of review.info().lines.entries()) {
    assert.ok(review.show(index, line.moves.length));
    assert.equal(review.view(defaults, 0).history.length, 1 + line.moves.length);
  }
});

test('review state retains evaluations and rejects invalid navigation payloads', () => {
  const game = finishedGame();
  const review = new Review(game.save(0), game.view(defaults, 0, false, false));
  review.accept([{ depth: 2, score: { kind: 'mate', value: 3 }, moves: ['e7e5'] }]);
  assert.ok(review.show(0, 1));
  const state = { preferences: defaults, review: review.info(), position: review.view(defaults, 0) };
  assert.deepEqual(parseResponse({ type: 'state', state }), { type: 'state', state });
  const invalidLine = { ...state.review.lines[0], inputs: [{ from: 'e9', to: 'e5' }] };
  assert.equal(parseResponse({ type: 'state', state: {
    ...state, review: { ...state.review, lines: [invalidLine] }
  } }), undefined);
  assert.equal(formatEvaluation(state.review.lines[0].score, 'en'), '−#3');
  assert.equal(parseAction({ type: 'reviewSeek', ply: -1 }), undefined);
  assert.equal(parseAction({ type: 'reviewPreview', line: 0, step: 0 }), undefined);
});

test('a played move outside the suggestions gets its own line from the same position', { timeout: 12_000 }, async () => {
  const game = finishedGame();
  const review = new Review(game.save(0), game.view(defaults, 0, false, false));
  const stockfish = new Stockfish(resolve('node_modules/stockfish/bin/stockfish-19-lite-single.js'));
  const root = review.enginePosition;
  assert.equal(review.playedMove, 'e7e5');
  const [played] = await stockfish.analyze(root, new AbortController().signal, review.playedMove);
  assert.equal(played.moves[0], 'e7e5');
  review.accept([{ depth: 12, score: { kind: 'cp', value: 8 }, moves: ['c7c5'] }], played);
  const info = review.info();
  assert.equal(info.alternativeCount, 1);
  assert.equal(info.playedLine, 1);
  assert.equal(info.lines[1].moves[0], 'e5');
  assert.ok(review.show(1, 1));
  assert.equal(review.view(defaults, 0).pieces.e5?.type, 'p');
  assert.deepEqual(review.enginePosition, root);
});
