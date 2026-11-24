import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/chess/game';
import { defaults, parseAction, parseResponse, type MoveInput, type Setup } from '../src/shared/protocol';

const local: Setup = { mode: 'local', color: 'w', control: 'off' };
const timed: Setup = { ...local, control: '3+2' };
const input = (from: MoveInput['from'], to: MoveInput['to'], promotion?: MoveInput['promotion']) =>
  ({ from, to, promotion });
function move(game: Game, from: MoveInput['from'], to: MoveInput['to'], now = 0) {
  assert.equal(game.play(input(from, to), now), true, `${from}–${to}`);
}
function view(game: Game) { return game.view(defaults, 0, false, false); }
function knightCycle(game: Game) {
  move(game, 'g1', 'f3'); move(game, 'g8', 'f6'); move(game, 'f3', 'g1'); move(game, 'f6', 'g8');
}

test('legal moves, capture hints and illegal moves keep the turn and history consistent', () => {
  const game = new Game(local);
  assert.equal(view(game).legal.length, 20);
  assert.equal(game.play(input('e2', 'e5'), 0), false);
  assert.equal(game.play(input('e7', 'e5'), 0), false);
  move(game, 'e2', 'e4');
  assert.equal(game.turn, 'b');
  assert.deepEqual(view(game).history, ['e4']);
  assert.deepEqual(view(game).last, input('e2', 'e4'));
});

test('castling is legal on a safe path and illegal across f1 when attacked', () => {
  const safe = new Game(local, '4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  move(safe, 'e1', 'g1');
  assert.equal(view(safe).pieces.f1?.type, 'r');
  const attacked = new Game(local, '4kr2/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(attacked.play(input('e1', 'g1'), 0), false);
});

test('en passant removes the captured pawn and Undo restores its square', () => {
  const game = new Game(local);
  move(game, 'e2', 'e4'); move(game, 'a7', 'a6'); move(game, 'e4', 'e5'); move(game, 'd7', 'd5');
  move(game, 'e5', 'd6');
  assert.equal(view(game).pieces.d5, undefined);
  assert.equal(view(game).pieces.d6?.color, 'w');
  assert.equal(game.undo(0, false), true);
  assert.deepEqual(view(game).pieces.d5, { color: 'b', type: 'p' });
});

test('promotion requires a piece and exposes all four choices', () => {
  const game = new Game(local, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const choices = view(game).legal.filter(m => m.from === 'a7').map(m => m.promotion);
  assert.deepEqual(choices.sort(), ['b', 'n', 'q', 'r']);
  assert.equal(game.play(input('a7', 'a8'), 0), false);
  assert.equal(game.play(input('a7', 'a8', 'n'), 0), true);
  assert.equal(view(game).pieces.a8?.type, 'n');
});

test('check, mate, stalemate and insufficient material have distinct outcomes', () => {
  const game = new Game(local);
  move(game, 'f2', 'f3'); move(game, 'e7', 'e5'); move(game, 'g2', 'g4'); move(game, 'd8', 'h4');
  assert.deepEqual(game.result, { reason: 'Checkmate', winner: 'b' });
  assert.equal(view(game).check, 'e1');
  assert.deepEqual(view(game).legal, []);
  assert.equal(game.play(input('a2', 'a3'), 0), false);
  assert.equal(game.undo(0, true), true);
  assert.equal(game.result, undefined);
  const check = new Game(local, '4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
  assert.equal(view(check).check, 'e8');
  assert.equal(check.result, undefined);
  assert.equal(new Game(local, '7k/5K2/6Q1/8/8/8/8/8 b - - 0 1').result?.reason, 'Stalemate');
  assert.equal(new Game(local, '4k3/8/8/8/8/8/7B/4K3 w - - 0 1').result?.reason, 'Insufficient material');
});

test('threefold claims work on current and intended positions and survive save/load', () => {
  const game = new Game(local);
  knightCycle(game);
  move(game, 'g1', 'f3'); move(game, 'g8', 'f6'); move(game, 'f3', 'g1');
  const restored = Game.restore(JSON.parse(JSON.stringify(game.save(0))))!;
  assert.equal(restored.turn, 'b');
  assert.equal(restored.claim(0, input('a7', 'a6')), false);
  assert.equal(restored.claim(0, input('f6', 'g8')), true);
  assert.equal(restored.result?.reason, 'Threefold repetition claimed');
  assert.equal(view(restored).history.length, 7);
  assert.equal(Game.restore(restored.save(0))?.result?.reason, 'Threefold repetition claimed');
  move(game, 'f6', 'g8');
  assert.equal(game.result, undefined);
  assert.equal(game.claim(0), true);
});

test('fivefold repetition ends the game automatically', () => {
  const game = new Game(local);
  for (let repeat = 0; repeat < 4; repeat++) knightCycle(game);
  assert.equal(game.result?.reason, 'Fivefold repetition');
});

test('50-move claim, 75-move draw, and checkmate priority', () => {
  const fifty = new Game(local, '4k3/8/8/8/8/8/R7/4K3 w - - 99 1');
  assert.equal(fifty.claim(0), false);
  assert.equal(fifty.claim(0, input('a2', 'a3')), true);
  assert.equal(fifty.result?.reason, '50-move rule claimed');
  const seventyFive = new Game(local, '4k3/8/8/8/8/8/R7/4K3 w - - 149 1');
  move(seventyFive, 'a2', 'a3');
  assert.equal(seventyFive.result?.reason, '75-move rule');
  const mate = new Game(local, '7k/5K2/6Q1/8/8/8/8/8 w - - 149 1');
  move(mate, 'g6', 'g7');
  assert.equal(mate.result?.reason, 'Checkmate');
});

test('local clocks tick, increment, pause, resume and are restored with Undo', () => {
  const game = new Game(timed);
  game.resume(1000);
  move(game, 'e2', 'e4', 4000);
  assert.equal(game.deadline, 184_000);
  assert.deepEqual(view(game).clock?.remaining, { w: 179_000, b: 180_000 });
  game.pause(7000);
  const restored = Game.restore(game.save(30_000))!;
  assert.equal(restored.deadline, undefined);
  assert.deepEqual(view(restored).clock?.remaining, { w: 179_000, b: 177_000 });
  restored.resume(40_000);
  assert.equal(restored.deadline, 217_000);
  assert.equal(restored.undo(41_000, true), true);
  assert.deepEqual(view(restored).clock?.remaining, { w: 177_000, b: 180_000 });
  assert.equal(restored.deadline, 218_000);
});

test('clock expires before a late move and can draw when the opponent cannot mate', () => {
  const game = new Game(timed);
  game.resume(0);
  assert.equal(game.expire(179_999), false);
  assert.equal(game.play(input('e2', 'e4'), 180_000), false);
  assert.deepEqual(game.result, { reason: 'Time expired', winner: 'b' });
  assert.equal(view(game).clock?.remaining.w, 0);
  const bareKing = new Game(timed, '4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
  bareKing.resume(0);
  assert.equal(bareKing.expire(180_000), true);
  assert.equal(bareKing.result?.reason, 'Draw on time · insufficient mating material');
});

test('mode setup, auto-flip, restart and bot Undo respect the human color', () => {
  const setup: Setup = { ...local, mode: 'computer', color: 'b' };
  const bot = new Game(setup);
  assert.equal(bot.botTurn, true);
  assert.equal(view(bot).flipped, true);
  move(bot, 'e2', 'e4');
  assert.equal(bot.canUndo, false);
  move(bot, 'e7', 'e5'); move(bot, 'g1', 'f3');
  assert.equal(bot.undo(0, true), true);
  assert.deepEqual(view(bot).history, ['e4']);
  assert.equal(bot.botTurn, false);

  const twoPlayers = new Game(local);
  assert.equal(view(twoPlayers).history.length, 0);
  assert.equal(twoPlayers.botTurn, false);
  move(twoPlayers, 'd2', 'd4');
  assert.equal(twoPlayers.view({ ...defaults, autoFlip: true }, 0, false, false).flipped, true);
  twoPlayers.flipBoard();
  assert.equal(twoPlayers.view({ ...defaults, autoFlip: true }, 0, false, false).flipped, false);
  assert.equal(twoPlayers.agree(0), true);
  assert.equal(twoPlayers.result?.reason, 'Draw by agreement');
});

test('save validation rejects unknown versions, illegal positions and corrupt legal history', () => {
  const game = new Game(local);
  assert.equal(Game.restore({ ...game.save(0), version: 999 }), undefined);
  assert.equal(Game.restore({ ...game.save(0), initialFen: 'garbage' }), undefined);
  assert.equal(Game.restore({ ...game.save(0), plies: [{ move: input('e2', 'e6') }] }), undefined);
});

test('webview actions validate names, settings and full move shapes', () => {
  assert.equal(parseAction({ type: 'runCommand' }), undefined);
  assert.equal(parseAction({ type: 'move', revision: 2, move: { from: 'e2', to: 'z6' } }), undefined);
  assert.equal(parseAction({ type: 'move', revision: 2, move: { from: 'e2', to: 'e4', promotion: 'k' } }), undefined);
  assert.equal(parseAction({ type: 'move', revision: -1, move: input('e2', 'e4') }), undefined);
  assert.equal(parseAction({ type: 'settings', preferences: { ...defaults, level: 10 } }), undefined);
  assert.deepEqual(parseAction({ type: 'start', revision: null, setup: { ...local, extra: 'ignored' } }),
    { type: 'start', revision: null, setup: local });
  const position = view(new Game(timed));
  const state = { preferences: defaults, position };
  assert.deepEqual(parseResponse({ type: 'state', state }), { type: 'state', state });
  assert.equal(parseResponse({ type: 'state', state: {
    ...state, position: { ...position, pieces: { a9: { color: 'b', type: 'k' } } }
  } }), undefined);
});
