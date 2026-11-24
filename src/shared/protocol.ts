import type { Color, PieceSymbol, Square } from 'chess.js';

export const themes = ['classic', 'minimal', 'dark'] as const;
export const pieceStyles = ['figurine', 'letter'] as const;
export const levels = [
  { label: 'Starter', rating: '≈400', skill: 0, variation: 0.6 },
  { label: 'Casual', rating: '≈900', skill: 3, variation: 0.24 },
  { label: 'Club', rating: '≈1400', elo: 1400 },
  { label: 'Advanced', rating: '≈1850', elo: 1850 },
  { label: 'Expert', rating: '≈2400', elo: 2400 },
  { label: 'Maximum', rating: '2400+', skill: 20, variation: 0 }
] as const;
export const times = [100, 300, 700, 1500, 3000] as const;
export const controls = ['off', '3+2', '5+0', '10+5', '15+10'] as const;

export type Promotion = 'q' | 'r' | 'b' | 'n';
export type MoveInput = { from: Square; to: Square; promotion?: Promotion };
export type Setup = {
  mode: 'computer' | 'local';
  color: Color;
  control: typeof controls[number];
};
export type Preferences = {
  theme: typeof themes[number];
  pieces: typeof pieceStyles[number];
  autoFlip: boolean;
  level: number;
  thinkMs: typeof times[number];
};
export const defaults: Preferences = {
  theme: 'classic', pieces: 'figurine', autoFlip: false, level: 2, thinkMs: 700
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
  thinking: boolean;
  engineError: boolean;
};
export type State = { position?: Position; preferences: Preferences };
export type Action =
  | { type: 'ready' }
  | { type: 'retry' }
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
export function isMove(value: unknown): value is MoveInput {
  return record(value)
    && isSquare(value.from)
    && isSquare(value.to)
    && (value.promotion === undefined || oneOf(['q', 'r', 'b', 'n'], value.promotion));
}
export function isSetup(value: unknown): value is Setup {
  return record(value) && oneOf(['computer', 'local'], value.mode)
    && oneOf(['w', 'b'], value.color) && oneOf(controls, value.control)
    && (value.mode === 'local' || value.control === 'off');
}
export function isPreferences(value: unknown): value is Preferences {
  return record(value) && oneOf(themes, value.theme) && oneOf(pieceStyles, value.pieces)
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
    case 'ready': case 'retry':
      return { type: value.type };
    case 'start':
      if (isSetup(value.setup) && (value.revision === null || isRevision(value.revision))) {
        const { mode, color, control } = value.setup;
        return { type: 'start', setup: { mode, color, control }, revision: value.revision };
      }
      return;
    case 'settings':
      if (isPreferences(value.preferences)) {
        const { theme, pieces, autoFlip, level, thinkMs } = value.preferences;
        return { type: 'settings', preferences: { theme, pieces, autoFlip, level, thinkMs } };
      }
      return;
    case 'undo': case 'flip': case 'claim': case 'resign': case 'agree':
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
  const { pieces, legal, history, last, check, clock, claim, result } = value;
  return [value.flipped, value.canUndo, value.thinking, value.engineError].every(flag => typeof flag === 'boolean')
    && record(pieces) && Object.entries(pieces).every(([square, piece]) =>
      isSquare(square) && record(piece) && isColor(piece.color) && oneOf(['p', 'n', 'b', 'r', 'q', 'k'], piece.type))
    && Array.isArray(legal) && legal.every(isMove)
    && Array.isArray(history) && history.every(move => typeof move === 'string' && move.length <= 16)
    && (last === undefined || isMove(last)) && (check === undefined || isSquare(check))
    && (clock === undefined || isClock(clock)) && (claim === undefined || typeof claim === 'string')
    && (result === undefined || (record(result) && typeof result.reason === 'string'
      && (result.winner === undefined || isColor(result.winner))));
}
export function parseResponse(value: unknown): Response | undefined {
  if (!record(value)) return;
  if (value.type === 'notice' && typeof value.message === 'string') return { type: 'notice', message: value.message };
  if (value.type === 'state' && record(value.state) && isPreferences(value.state.preferences)
    && (value.state.position === undefined || isPosition(value.state.position))) {
    return { type: 'state', state: { preferences: value.state.preferences, position: value.state.position } };
  }
}
