import { Game } from '../chess/game';
import { isMove, type MoveInput, type Position, type Preferences } from '../shared/protocol';
import type { PuzzleFilter } from '../shared/puzzles';

export type Puzzle = [id: string, fen: string, moves: string, rating: number, tags: string[]];

function decodeMove(value: string): MoveInput {
  const move = {
    from: value.slice(0, 2), to: value.slice(2, 4), promotion: value[4]
  };
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value) || !isMove(move)) {
    throw new Error(`Invalid puzzle move: ${value}`);
  }
  return move;
}

function matchesRating(rating: number, difficulty: PuzzleFilter['difficulty']) {
  switch (difficulty) {
    case 'any': return true;
    case 'under1200': return rating < 1200;
    case '1200to1599': return rating >= 1200 && rating < 1600;
    case '1600to1999': return rating >= 1600 && rating < 2000;
    case '2000plus': return rating >= 2000;
  }
}

export class PuzzlePack {
  private readonly seen = new Set<string>();

  constructor(readonly entries: readonly Puzzle[]) {}

  next(filter: PuzzleFilter, solved: ReadonlySet<string>, currentId?: string) {
    const matches = this.entries.filter(([id, , , rating, tags]) =>
      id !== currentId && matchesRating(rating, filter.difficulty) &&
      (filter.theme === 'any' || tags.includes(filter.theme)));
    const unseen = matches.filter(([id]) => !this.seen.has(id) && !solved.has(id));
    const pool = unseen.length ? unseen : matches;
    const puzzle = pool[Math.floor(Math.random() * pool.length)];
    if (!puzzle) return;
    const session = new PuzzleSession(puzzle);
    this.seen.add(session.id);
    return session;
  }
}

export class PuzzleSession {
  private readonly board: Game;
  private readonly moves: MoveInput[];
  private readonly color: Position['turn'];
  private index = 0;
  private hintVisible = false;
  private revealed = false;

  constructor(private readonly puzzle: Puzzle) {
    this.moves = puzzle[2].split(' ').map(decodeMove);
    if (this.moves.length % 2 !== 1) throw new Error(`Invalid puzzle line: ${this.id}`);
    this.board = new Game({ mode: 'local', color: 'w', control: 'off' }, puzzle[1]);
    this.color = this.board.turn;
    if (this.color === 'b') this.board.flipBoard();
  }

  get id() { return this.puzzle[0]; }
  get rating() { return this.puzzle[3]; }
  get status() { return this.revealed ? 'revealed' : this.index === this.moves.length ? 'solved' : 'active'; }
  retry() { return new PuzzleSession(this.puzzle); }
  get hint() { return this.hintVisible ? this.moves[this.index]?.from : undefined; }

  showHint() {
    if (this.status === 'active') this.hintVisible = true;
  }

  solveMove(input: MoveInput) {
    const expected = this.moves[this.index];
    if (this.status !== 'active' || !expected || input.from !== expected.from
      || input.to !== expected.to || input.promotion !== expected.promotion) return false;
    this.playExpectedMove();
    if (this.index < this.moves.length) this.playExpectedMove();
    this.hintVisible = false;
    return true;
  }

  reveal() {
    if (this.status !== 'active') return;
    while (this.index < this.moves.length) this.playExpectedMove();
    this.hintVisible = false;
    this.revealed = true;
  }

  private playExpectedMove() {
    if (!this.board.play(this.moves[this.index], 0)) throw new Error(`Illegal puzzle line: ${this.id}`);
    this.index++;
  }

  view(preferences: Preferences, revision: number): Position {
    const position = this.board.view({ ...preferences, autoFlip: false }, revision, false, false);
    return {
      ...position, turn: this.status === 'active' ? position.turn : this.color,
      legal: this.status === 'active' ? position.legal : [],
      result: undefined, canUndo: false, claim: undefined, claimMoves: []
    };
  }
}
