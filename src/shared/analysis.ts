import type { MoveInput } from './protocol';

export type Evaluation = { kind: 'cp' | 'mate'; value: number };
export type ReviewLine = { score: Evaluation; depth: number; moves: string[]; inputs: MoveInput[] };
export type ReviewInfo = {
  ply: number;
  history: string[];
  status: 'searching' | 'ready' | 'terminal' | 'error';
  lines: ReviewLine[];
  playedLine?: number;
  alternativeCount: number;
  preview?: { line: number; step: number };
};

export function formatEvaluation(score: Evaluation, language: string) {
  if (score.kind === 'mate') return score.value < 0 ? `−#${-score.value}` : `#${score.value}`;
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'
  }).format(score.value / 100);
}
