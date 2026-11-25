import { Chess } from 'chess.js';
import { Game, type SavedGame } from '../chess/game';
import type { EngineLine } from '../engine/stockfish';
import type { ReviewInfo, ReviewLine } from '../shared/analysis';
import { isMove, type MoveInput, type Position, type Preferences } from '../shared/protocol';

export class Review {
  readonly history: string[];
  private board: Game;
  private currentPly: number;
  private readonly cache = new Map<number, { lines: ReviewLine[]; alternativeCount: number; playedLine?: number }>();
  private preview?: { line: number; step: number };
  failed = false;

  constructor(private readonly snapshot: SavedGame, position: Position) {
    this.history = [...position.history];
    this.currentPly = Math.max(0, this.history.length - 1);
    this.board = this.boardAt(this.currentPly);
    this.flipped = position.flipped;
  }

  private readonly flipped: boolean;
  get ply() { return this.currentPly; }
  get enginePosition() { return this.board.enginePosition(); }
  get playedMove() {
    const move = this.snapshot.plies[this.ply]?.move;
    return move && move.from + move.to + (move.promotion ?? '');
  }
  get hasLines() { return this.cache.has(this.ply); }
  get terminal() { return Boolean(this.board.result) || this.enginePosition.legal.length === 0; }

  seek(ply: number) {
    if (!Number.isInteger(ply) || ply < 0 || ply > this.history.length) return false;
    if (ply === this.currentPly && !this.preview) return false;
    this.preview = undefined;
    this.failed = false;
    if (ply !== this.currentPly) {
      this.board = this.boardAt(ply);
      this.currentPly = ply;
    }
    return true;
  }

  show(line: number, step: number) {
    const variation = this.cache.get(this.ply)?.lines[line];
    if (!variation || step < 1 || step > variation.inputs.length) return false;
    this.preview = { line, step };
    return true;
  }

  accept(lines: EngineLine[], extraPlayedLine?: EngineLine) {
    const { fen, moves } = this.enginePosition;
    const sign = this.board.turn === 'w' ? 1 : -1;
    const toVariation = (line: EngineLine): ReviewLine => {
      const chess = new Chess(fen);
      for (const move of moves) chess.move(move);
      const branch = this.boardAt(this.ply);
      const inputs: MoveInput[] = [];
      const san: string[] = [];
      for (const move of line.moves) {
        const input = { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] };
        if (!isMove(input) || !branch.play(input, 0)) break;
        try {
          san.push(chess.move(input).san);
          inputs.push(input);
        } catch { break; }
      }
      return { depth: line.depth, score: { ...line.score, value: sign * line.score.value }, moves: san, inputs };
    };
    const variations = lines.map(toVariation).filter(line => line.moves.length > 0);
    if (!variations.length) throw new Error('Stockfish returned no legal variations');
    const alternativeCount = variations.length;
    const playedMove = this.playedMove;
    let playedLine = playedMove ? variations.findIndex(line =>
      line.inputs[0].from + line.inputs[0].to + (line.inputs[0].promotion ?? '') === playedMove) : -1;
    if (playedLine === -1 && extraPlayedLine && extraPlayedLine.moves[0] === playedMove) {
      const line = toVariation(extraPlayedLine);
      if (line.moves.length) {
        playedLine = variations.length;
        variations.push(line);
      }
    }
    this.cache.set(this.ply, { lines: variations, alternativeCount, playedLine: playedLine < 0 ? undefined : playedLine });
  }

  info(): ReviewInfo {
    const result = this.cache.get(this.ply);
    return {
      ply: this.ply, history: this.history, preview: this.preview,
      status: this.failed ? 'error' : result ? 'ready' : this.terminal ? 'terminal' : 'searching',
      lines: result?.lines ?? [],
      alternativeCount: result?.alternativeCount ?? 0, playedLine: result?.playedLine
    };
  }

  view(preferences: Preferences, revision: number): Position {
    let board = this.board;
    if (this.preview) {
      const { line, step } = this.preview;
      board = this.boardAt(this.ply);
      const inputs = this.cache.get(this.ply)!.lines[line].inputs;
      for (const move of inputs.slice(0, step)) {
        if (!board.play(move, 0)) break;
      }
    }
    return {
      ...board.view({ ...preferences, autoFlip: false }, revision, false, false),
      flipped: this.flipped, legal: [], canUndo: false, claim: undefined, claimMoves: []
    };
  }

  private boardAt(ply: number) {
    // A review board never shares the original game's clock or result state.
    const board = new Game({ mode: 'local', color: 'w', control: 'off' }, this.snapshot.initialFen);
    for (const { move } of this.snapshot.plies.slice(0, ply)) {
      if (!board.play(move, 0)) throw new Error('Could not replay game history');
    }
    return board;
  }
}
