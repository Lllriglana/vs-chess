import { Chess, DEFAULT_POSITION, type Color, type Move, type Square } from 'chess.js';
import {
  isMove, isSetup, record, type Clock, type MoveInput, type Position,
  type Preferences, type Result, type Setup
} from '../shared/protocol';

type Remainder = Clock['remaining'];
type Ply = { move: MoveInput; before?: Remainder };
export type SavedGame = {
  version: 1;
  setup: Setup;
  initialFen: string;
  plies: Ply[];
  flip: boolean;
  remaining?: Remainder;
  result?: Result;
};
type ClockSettings = { initial: number; increment: number };
const opposite = (color: Color): Color => color === 'w' ? 'b' : 'w';
const moveInput = ({ from, to, promotion }: Move): MoveInput =>
  ({ from, to, promotion: promotion as MoveInput['promotion'] });

function clockSettings(control: Setup['control']): ClockSettings | undefined {
  if (control === 'off') return;
  const [minutes, seconds] = control.split('+').map(Number);
  return { initial: minutes * 60_000, increment: seconds * 1000 };
}
function isRemainder(value: unknown): value is Remainder {
  if (!record(value)) return false;
  return ['w', 'b'].every(key => {
    const ms = value[key];
    return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= 100_000_000;
  });
}
const savedResults = [
  'Threefold repetition claimed', '50-move rule claimed', 'Draw by agreement',
  'Draw on time · insufficient mating material', 'Time expired', 'Resignation'
];

export class Game {
  private readonly chess: Chess;
  private readonly moves: Move[] = [];
  private readonly plies: Ply[] = [];
  private readonly occurrences = new Map<string, number>();
  private readonly control: ClockSettings | undefined;
  private remaining: Remainder | undefined;
  private startedAt: number | null = null;
  private flip = false;
  private ending: Result | undefined;

  constructor(readonly setup: Setup, private readonly initialFen = DEFAULT_POSITION) {
    this.chess = new Chess(initialFen);
    this.trackPosition(1);
    this.control = clockSettings(setup.control);
    if (this.control) this.remaining = { w: this.control.initial, b: this.control.initial };
    this.ending = this.boardResult();
  }

  get turn() { return this.chess.turn(); }
  get result() { return this.ending; }
  get botTurn() { return !this.ending && this.setup.mode === 'computer' && this.turn !== this.setup.color; }
  get canUndo() {
    if (this.setup.mode === 'local') return this.plies.length > 0;
    const opening = this.setup.color === 'b' ? 1 : 0;
    return this.plies.length > opening;
  }
  get deadline() {
    if (this.startedAt === null || !this.remaining || this.ending) return;
    return this.startedAt + this.remaining[this.turn];
  }

  enginePosition() {
    return {
      fen: this.initialFen,
      moves: this.plies.map(({ move }) => move.from + move.to + (move.promotion ?? '')),
      legal: this.chess.moves({ verbose: true }).map(moveInput)
    };
  }

  private positionKey() { return this.chess.fen().split(' ', 4).join(' '); }
  private trackPosition(delta: number) {
    const key = this.positionKey();
    const count = (this.occurrences.get(key) ?? 0) + delta;
    if (count === 0) this.occurrences.delete(key);
    else this.occurrences.set(key, count);
  }
  private boardResult(): Result | undefined {
    if (this.chess.isCheckmate()) return { reason: 'Checkmate', winner: opposite(this.turn) };
    if (this.chess.isStalemate()) return { reason: 'Stalemate' };
    if (this.chess.isInsufficientMaterial()) return { reason: 'Insufficient material' };
    if ((this.occurrences.get(this.positionKey()) ?? 0) >= 5) return { reason: 'Fivefold repetition' };
    if (Number(this.chess.fen().split(' ')[4]) >= 150) return { reason: '75-move rule' };
  }
  private drawClaim(extraOccurrence = 0) {
    if (this.chess.isDrawByFiftyMoves()) return '50-move rule claimed';
    if ((this.occurrences.get(this.positionKey()) ?? 0) + extraOccurrence >= 3) {
      return 'Threefold repetition claimed';
    }
  }
  private settle(now: number) {
    if (!this.remaining || this.startedAt === null) return;
    this.remaining[this.turn] = Math.max(0, this.remaining[this.turn] - Math.max(0, now - this.startedAt));
    this.startedAt = now;
  }
  private finish(result: Result, now: number) {
    this.pause(now);
    this.ending = result;
  }
  resume(now: number) {
    if (this.remaining && this.startedAt === null && !this.ending) this.startedAt = now;
  }
  pause(now: number) {
    this.settle(now);
    this.startedAt = null;
  }
  expire(now: number) {
    const deadline = this.deadline;
    if (deadline === undefined || now < deadline) return false;
    const winner = opposite(this.turn);
    this.finish(this.hasMatingMaterial(winner)
      ? { reason: 'Time expired', winner }
      : { reason: 'Draw on time · insufficient mating material' }, now);
    return true;
  }
  private hasMatingMaterial(color: Color) {
    const pieces = this.chess.board().flat().filter(piece => piece !== null);
    const own = pieces.filter(piece => piece.color === color && piece.type !== 'k');
    const other = pieces.filter(piece => piece.color !== color && piece.type !== 'k');
    if (own.some(piece => piece.type === 'p' || piece.type === 'q' || piece.type === 'r')) return true;
    if (own.length === 0) return false;
    if (own.every(piece => piece.type === 'b')) {
      const squareColors = new Set(own.map(piece => this.chess.squareColor(piece.square)));
      return squareColors.size > 1 || other.some(piece =>
        piece.type === 'p' || piece.type === 'n' || (piece.type === 'b' && !squareColors.has(this.chess.squareColor(piece.square))));
    }
    if (own.length > 1) return true;
    return other.some(piece => piece.type !== 'q');
  }

  play(input: MoveInput, now: number) {
    if (this.ending || this.expire(now)) return false;
    const turn = this.turn;
    this.settle(now);
    let played: Move;
    try { played = this.chess.move(input); }
    catch { return false; }
    const before = this.remaining && { ...this.remaining };
    if (this.remaining && this.control) this.remaining[turn] += this.control.increment;
    this.moves.push(played);
    this.plies.push({ move: moveInput(played), before });
    this.trackPosition(1);
    this.ending = this.boardResult();
    if (this.ending) this.startedAt = null;
    return true;
  }
  claim(now: number, intended?: MoveInput) {
    if (this.ending || this.expire(now)) return false;
    let reason: string | undefined;
    if (intended) {
      try { this.chess.move(intended); }
      catch { return false; }
      try { reason = this.drawClaim(1); }
      finally { this.chess.undo(); }
    } else {
      reason = this.drawClaim();
    }
    if (!reason) return false;
    this.finish({ reason }, now);
    return true;
  }
  resign(now: number) {
    if (this.ending || this.expire(now)) return false;
    const player = this.setup.mode === 'computer' ? this.setup.color : this.turn;
    this.finish({ reason: 'Resignation', winner: opposite(player) }, now);
    return true;
  }
  agree(now: number) {
    if (this.ending || this.setup.mode !== 'local' || this.expire(now)) return false;
    this.finish({ reason: 'Draw by agreement' }, now);
    return true;
  }
  undo(now: number, visible: boolean) {
    if (!this.canUndo) return false;
    const count = this.setup.mode === 'computer' && this.turn === this.setup.color ? 2 : 1;
    for (let i = 0; i < count; i++) {
      this.trackPosition(-1);
      this.chess.undo();
      this.moves.pop();
      this.remaining = this.plies.pop()?.before;
    }
    this.startedAt = null;
    this.ending = this.boardResult();
    if (visible) this.resume(now);
    return true;
  }
  flipBoard() { this.flip = !this.flip; }

  view(preferences: Preferences, revision: number, thinking: boolean, engineError: boolean): Position {
    const pieces: Position['pieces'] = {};
    let king: Square | undefined;
    const inCheck = this.chess.isCheck();
    for (const piece of this.chess.board().flat()) {
      if (!piece) continue;
      pieces[piece.square] = { color: piece.color, type: piece.type };
      if (inCheck && piece.type === 'k' && piece.color === this.turn) king = piece.square;
    }
    const blackAtBottom = this.setup.mode === 'computer'
      ? this.setup.color === 'b' : preferences.autoFlip && this.turn === 'b';
    const last = this.moves.at(-1);
    return {
      revision, setup: this.setup, flipped: blackAtBottom !== this.flip, turn: this.turn, pieces,
      legal: this.ending || this.botTurn ? [] : this.chess.moves({ verbose: true }).map(moveInput),
      history: this.moves.map(move => move.san), last: last && moveInput(last), check: king,
      result: this.ending, clock: this.remaining && { remaining: { ...this.remaining }, startedAt: this.startedAt },
      canUndo: this.canUndo, claim: this.ending || this.botTurn ? undefined : this.drawClaim(),
      thinking, engineError
    };
  }

  save(now: number): SavedGame {
    const remaining = this.remaining && { ...this.remaining };
    if (remaining && this.startedAt !== null) {
      remaining[this.turn] = Math.max(0, remaining[this.turn] - Math.max(0, now - this.startedAt));
    }
    return {
      version: 1, setup: this.setup, initialFen: this.initialFen, plies: this.plies.slice(),
      flip: this.flip, remaining, result: this.ending
    };
  }

  static restore(saved: unknown) {
    if (!record(saved) || saved.version !== 1 || !isSetup(saved.setup) || typeof saved.initialFen !== 'string'
      || saved.initialFen.length > 120 || typeof saved.flip !== 'boolean'
      || !Array.isArray(saved.plies) || saved.plies.length > 25_000) return;
    try {
      const game = new Game(saved.setup, saved.initialFen);
      const timed = Boolean(game.control);
      for (const ply of saved.plies) {
        if (!record(ply) || !isMove(ply.move) || (timed && !isRemainder(ply.before))) return;
        if (timed && isRemainder(ply.before)) game.remaining = { w: ply.before.w, b: ply.before.b };
        if (!game.play(ply.move, 0)) return;
      }
      if (timed) {
        if (!isRemainder(saved.remaining)) return;
        game.remaining = { w: saved.remaining.w, b: saved.remaining.b };
      }
      game.flip = saved.flip;
      if (!game.ending && record(saved.result) && typeof saved.result.reason === 'string'
        && savedResults.includes(saved.result.reason)) {
        const winner = saved.result.winner;
        game.ending = { reason: saved.result.reason, winner: winner === 'w' || winner === 'b' ? winner : undefined };
      }
      return game;
    } catch { return; }
  }
}
