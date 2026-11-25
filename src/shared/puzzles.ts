export const puzzleDifficulties = ['any', 'under1200', '1200to1599', '1600to1999', '2000plus'] as const;
export const puzzleThemes = ['any', 'mateIn1', 'mateIn2', 'fork', 'pin', 'endgame', 'sacrifice'] as const;

export type PuzzleFilter = {
  difficulty: typeof puzzleDifficulties[number];
  theme: typeof puzzleThemes[number];
};

export const defaultPuzzleFilter: PuzzleFilter = { difficulty: 'any', theme: 'any' };

export const puzzleDifficultyLabels: Record<PuzzleFilter['difficulty'], string> = {
  any: 'Any rating', under1200: 'Under 1200', '1200to1599': '1200–1599',
  '1600to1999': '1600–1999', '2000plus': '2000 and up'
};

export const puzzleThemeLabels: Record<PuzzleFilter['theme'], string> = {
  any: 'Any theme', mateIn1: 'Mate in one', mateIn2: 'Mate in two',
  fork: 'Fork', pin: 'Pin', endgame: 'Endgame', sacrifice: 'Sacrifice'
};
