import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PuzzlePack, PuzzleSession, type Puzzle } from '../src/puzzles/puzzles';
import { defaults, isMove, parseAction, parseResponse } from '../src/shared/protocol';
import { defaultPuzzleFilter } from '../src/shared/puzzles';

const pack: Puzzle[] = JSON.parse(readFileSync('data/puzzles.json', 'utf8'));
const fixture = pack.find(puzzle => puzzle[2].split(' ').length > 1)!;
const notation = (move: string) => {
  const input = { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] };
  assert.ok(isMove(input));
  return input;
};

test('the offline pack contains unique legal starting positions and complete solutions', () => {
  assert.equal(pack.length, 9781);
  assert.equal(new Set(pack.map(puzzle => puzzle[0])).size, pack.length);
  assert.equal(new Set(pack.map(puzzle => puzzle[1].split(' ', 4).join(' '))).size, pack.length);
  for (const entry of pack) {
    const session = new PuzzleSession(entry);
    assert.ok(session.view(defaults, 0).legal.length > 0, session.id);
    session.reveal();
    assert.equal(session.status, 'revealed');
  }
});

test('a wrong move keeps the position; hints and scripted replies advance the solution', () => {
  const session = new PuzzleSession(fixture);
  const [first, , ...continuation] = fixture[2].split(' ');
  const before = session.view(defaults, 0);
  const wrong = before.legal.find(move => move.from !== first.slice(0, 2) || move.to !== first.slice(2, 4));
  assert.ok(wrong);
  assert.equal(session.solveMove(wrong), false);
  assert.deepEqual(session.view(defaults, 0), before);
  session.showHint();
  assert.equal(session.hint, first.slice(0, 2));
  assert.equal(session.solveMove(notation(first)), true);
  assert.equal(session.view(defaults, 1).history.length, 2);
  assert.equal(session.view(defaults, 1).turn, before.turn);
  assert.equal(session.hint, undefined);
  for (const [i, ply] of continuation.entries()) {
    if (i % 2 === 0) assert.equal(session.solveMove(notation(ply)), true);
  }
  assert.equal(session.status, 'solved');
  assert.deepEqual(session.view(defaults, 2).legal, []);
  assert.deepEqual(session.retry().view(defaults, 0), before);
});

test('filters select matching ratings and themes and prefer unseen unsolved positions', () => {
  const library = new PuzzlePack(pack);
  const filter = { theme: 'fork', difficulty: '1200to1599' } as const;
  const first = library.next(filter, new Set())!;
  const second = library.next(filter, new Set([first.id]))!;
  assert.notEqual(first.id, second.id);
  for (const puzzle of [first, second]) {
    const entry = pack.find(item => item[0] === puzzle.id)!;
    assert.ok(entry[4].includes('fork'));
    assert.ok(puzzle.rating >= 1200 && puzzle.rating < 1600);
  }
});

test('puzzle protocol validates filters and board metadata', () => {
  assert.deepEqual(parseAction({ type: 'puzzleNext', filter: defaultPuzzleFilter }),
    { type: 'puzzleNext', filter: defaultPuzzleFilter });
  assert.equal(parseAction({ type: 'puzzleNext', filter: { difficulty: 'any', theme: 'unknown' } }), undefined);
  assert.equal(parseAction({ type: 'puzzleReveal', revision: -1 }), undefined);
  const session = new PuzzleSession(fixture);
  const state = { preferences: defaults, position: session.view(defaults, 0), puzzle: {
    id: session.id, rating: session.rating, filter: defaultPuzzleFilter, status: session.status, solved: 0
  } };
  assert.deepEqual(parseResponse({ type: 'state', state }), { type: 'state', state });
});
