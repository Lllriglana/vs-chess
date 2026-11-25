import type { ReviewInfo } from './analysis';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { languages, type Language } from './languages';
import { puzzleDifficulties, puzzleThemes, type PuzzleFilter } from './puzzles';

export const themes = ['classic', 'minimal', 'dark'] as const;
export const pieceStyles = ['figurine', 'letter'] as const;
// Keep the original IDs stable: the selected index is stored in user preferences.
export const levels = [
  { label: 'Starter', rating: 400, skill: 0, variation: 0.6 },
  { label: 'Casual', rating: 900, skill: 3, variation: 0.24 },
  { label: 'Club', rating: 1400, elo: 1400 },
  { label: 'Advanced', rating: 1850, elo: 1850 },
  { label: 'Expert', rating: 2400, elo: 2400 },
  { label: 'Maximum', rating: null, skill: 20, variation: 0 },
  { label: 'Beginner', rating: 650, skill: 1, variation: 0.42 },
  { label: 'Intermediate', rating: 1150, skill: 5, variation: 0.12 },
  { label: 'Stockfish', rating: 1320, elo: 1320 },
  { label: 'Stockfish', rating: 1600, elo: 1600 },
  { label: 'Stockfish', rating: 2000, elo: 2000 },
  { label: 'Stockfish', rating: 2200, elo: 2200 },
  { label: 'Stockfish', rating: 2600, elo: 2600 },
  { label: 'Stockfish', rating: 2800, elo: 2800 },
  { label: 'Stockfish', rating: 3000, elo: 3000 },
  { label: 'Stockfish', rating: 3190, elo: 3190 }
] as const;
export const levelOrder = levels.map((_, index) => index)
  .sort((a, b) => (levels[a].rating ?? Infinity) - (levels[b].rating ?? Infinity));
export const times = [100, 300, 700, 1500, 3000] as const;
export const controls = ['off', '3+2', '5+0', '10+5', '15+10'] as const;

export type Promotion = 'q' | 'r' | 'b' | 'n';
export type MoveInput = { from: Square; to: Square; promotion?: Promotion };
export type Setup = {
  mode: 'computer' | 'local';
  color: Color;
  randomColor?: true;
  control: typeof controls[number];
};
export type Preferences = {
  language: Language;
  theme: typeof themes[number];
  pieces: typeof pieceStyles[number];
  autoFlip: boolean;
  level: number;
  thinkMs: typeof times[number];
};
export const defaults: Preferences = {
  language: 'en', theme: 'classic', pieces: 'figurine', autoFlip: false, level: 2, thinkMs: 700
};
export const defaultSetup: Setup = { mode: 'computer', color: 'w', control: 'off' };
export type Clock = { remaining: Record<Color, number>; startedAt: number | null };
export type Result = { reason: string; winner?: Color };
export type Position = {
  revision: number;
  setup: Setup;
  flipped: boolean;
  turn: Color;
  pieces: Partial<Record<Square, { color: Color; type: PieceSymbol }>>;
  legal: MoveInput[];
  history: string[];
  last: MoveInput | undefined;
  check: Square | undefined;
  result: Result | undefined;
  clock: Clock | undefined;
  canUndo: boolean;
  claim: string | undefined;
  claimMoves: MoveInput[];
  thinking: boolean;
  engineError: boolean;
};
export type PuzzleInfo = {
  id: string;
  rating: number;
  solved: number;
  status: 'active' | 'solved' | 'revealed';
  filter: PuzzleFilter;
  hint?: Square;
};
export type State = { position?: Position; puzzle?: PuzzleInfo; review?: ReviewInfo; preferences: Preferences };
export type Action =
  | { type: 'ready' }
  | { type: 'retry' }
  | { type: 'puzzleOpen' | 'puzzleClose' | 'reviewOpen' | 'reviewClose' | 'reviewRetry' }
  | { type: 'reviewSeek'; ply: number }
  | { type: 'reviewPreview'; line: number; step: number }
  | { type: 'puzzleNext'; filter: PuzzleFilter }
  | { type: 'puzzleHint' | 'puzzleReveal' | 'puzzleRetry'; revision: number }
  | { type: 'start'; setup: Setup; revision: number | null }
  | { type: 'settings'; preferences: Preferences }
  | { type: 'undo' | 'flip' | 'claim' | 'resign' | 'agree'; revision: number }
  | { type: 'move' | 'claimMove'; move: MoveInput; revision: number };
export type Response = { type: 'state'; state: State } | { type: 'notice'; message: string };

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function oneOf<T>(values: readonly T[], value: unknown): value is T {
  return values.some(item => item === value);
}
function isPuzzleFilter(value: unknown): value is PuzzleFilter {
  return record(value) && oneOf(puzzleDifficulties, value.difficulty) && oneOf(puzzleThemes, value.theme);
}
function isPuzzleInfo(value: unknown): value is PuzzleInfo {
  return record(value) && typeof value.id === 'string' && /^[a-zA-Z0-9]{5}$/.test(value.id)
    && isRevision(value.rating) && isRevision(value.solved) && isPuzzleFilter(value.filter)
    && oneOf(['active', 'solved', 'revealed'], value.status)
    && (value.hint === undefined || isSquare(value.hint));
}
export function isMove(value: unknown): value is MoveInput {
  return record(value)
    && isSquare(value.from)
    && isSquare(value.to)
    && (value.promotion === undefined || oneOf(['q', 'r', 'b', 'n'], value.promotion));
}
export function isSetup(value: unknown): value is Setup {
  return record(value) && oneOf(['computer', 'local'], value.mode)
    && oneOf(['w', 'b'], value.color) && oneOf(controls, value.control)
    && (value.mode === 'local' || value.control === 'off')
    && (value.randomColor === undefined || (value.mode === 'computer' && value.randomColor === true));
}
export function isPreferences(value: unknown): value is Preferences {
  return record(value) && oneOf(languages, value.language) && oneOf(themes, value.theme) && oneOf(pieceStyles, value.pieces)
    && typeof value.autoFlip === 'boolean' && typeof value.level === 'number'
    && Number.isInteger(value.level) && value.level >= 0 && value.level < levels.length
    && oneOf(times, value.thinkMs);
}
export function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function parseAction(value: unknown): Action | undefined {
  if (!record(value)) return;
  switch (value.type) {
    case 'ready': case 'retry': case 'puzzleOpen': case 'puzzleClose':
    case 'reviewOpen': case 'reviewClose': case 'reviewRetry':
      return { type: value.type };
    case 'reviewSeek':
      if (isRevision(value.ply)) return { type: 'reviewSeek', ply: value.ply };
      return;
    case 'reviewPreview':
      if (isRevision(value.line) && isRevision(value.step) && value.step > 0) {
        return { type: 'reviewPreview', line: value.line, step: value.step };
      }
      return;
    case 'start':
      if (isSetup(value.setup) && (value.revision === null || isRevision(value.revision))) {
        const { mode, color, control } = value.setup;
        const setup: Setup = { mode, color, control };
        if (value.setup.randomColor) setup.randomColor = true;
        return { type: 'start', setup, revision: value.revision };
      }
      return;
    case 'puzzleNext':
      if (isPuzzleFilter(value.filter)) return { type: 'puzzleNext', filter: value.filter };
      return;
    case 'settings':
      if (isPreferences(value.preferences)) {
        const { language, theme, pieces, autoFlip, level, thinkMs } = value.preferences;
        return { type: 'settings', preferences: { language, theme, pieces, autoFlip, level, thinkMs } };
      }
      return;
    case 'undo': case 'flip': case 'claim': case 'resign': case 'agree':
    case 'puzzleHint': case 'puzzleReveal': case 'puzzleRetry':
      if (isRevision(value.revision)) return { type: value.type, revision: value.revision };
      return;
    case 'move': case 'claimMove':
      if (isRevision(value.revision) && isMove(value.move)) {
        const { from, to, promotion } = value.move;
        return { type: value.type, revision: value.revision, move: { from, to, promotion } };
      }
  }
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}
function isColor(value: unknown): value is Color {
  return value === 'w' || value === 'b';
}
function isClock(value: unknown): value is Clock {
  if (!record(value) || !record(value.remaining)) return false;
  const { w, b } = value.remaining;
  const validMs = (ms: unknown) => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0;
  return validMs(w) && validMs(b) && (value.startedAt === null || validMs(value.startedAt));
}
function isPosition(value: unknown): value is Position {
  if (!record(value) || !isRevision(value.revision) || !isSetup(value.setup) || !isColor(value.turn)) return false;
  const { pieces, legal, history, last, check, clock, claim, claimMoves, result } = value;
  return [value.flipped, value.canUndo, value.thinking, value.engineError].every(flag => typeof flag === 'boolean')
    && record(pieces) && Object.entries(pieces).every(([square, piece]) =>
      isSquare(square) && record(piece) && isColor(piece.color) && oneOf(['p', 'n', 'b', 'r', 'q', 'k'], piece.type))
    && Array.isArray(legal) && legal.every(isMove)
    && Array.isArray(claimMoves) && claimMoves.every(isMove)
    && Array.isArray(history) && history.every(move => typeof move === 'string' && move.length <= 16)
    && (last === undefined || isMove(last)) && (check === undefined || isSquare(check))
    && (clock === undefined || isClock(clock)) && (claim === undefined || typeof claim === 'string')
    && (result === undefined || (record(result) && typeof result.reason === 'string'
      && (result.winner === undefined || isColor(result.winner))));
}
function isReviewInfo(value: unknown): value is ReviewInfo {
  if (!record(value) || !isRevision(value.ply) || !Array.isArray(value.history)
    || value.ply > value.history.length || !value.history.every(move => typeof move === 'string')
    || !oneOf(['searching', 'ready', 'terminal', 'error'], value.status)
    || !Array.isArray(value.lines) || value.lines.length > 4 || !isRevision(value.alternativeCount)
    || value.alternativeCount > 3 || value.alternativeCount > value.lines.length
    || (value.playedLine !== undefined && (!isRevision(value.playedLine) || value.playedLine >= value.lines.length))) return false;
  if (!value.lines.every(line => record(line) && isRevision(line.depth)
    && Array.isArray(line.moves) && line.moves.length > 0 && line.moves.length <= 12
    && line.moves.every(move => typeof move === 'string')
    && Array.isArray(line.inputs) && line.inputs.length === line.moves.length && line.inputs.every(isMove)
    && record(line.score) && oneOf(['cp', 'mate'], line.score.kind)
    && typeof line.score.value === 'number' && Number.isSafeInteger(line.score.value))) return false;
  const { preview } = value;
  return preview === undefined || (record(preview) && isRevision(preview.line) && isRevision(preview.step)
    && preview.step > 0 && preview.step <= (value.lines[preview.line]?.moves.length ?? 0));
}
export function parseResponse(value: unknown): Response | undefined {
  if (!record(value)) return;
  if (value.type === 'notice' && typeof value.message === 'string') return { type: 'notice', message: value.message };
  if (value.type === 'state' && record(value.state) && isPreferences(value.state.preferences)
    && (value.state.position === undefined || isPosition(value.state.position))
    && (value.state.puzzle === undefined || (value.state.position !== undefined && isPuzzleInfo(value.state.puzzle)))
    && (value.state.review === undefined || (value.state.position !== undefined && isReviewInfo(value.state.review)))) {
    return { type: 'state', state: {
      preferences: value.state.preferences, position: value.state.position, ...(value.state.puzzle && { puzzle: value.state.puzzle }),
      ...(value.state.review && { review: value.state.review })
    } };
  }
}
