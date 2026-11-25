import type { Memento } from 'vscode';
import { Game } from '../chess/game';
import { defaults, isPreferences, record, type Preferences } from '../shared/protocol';

const gameKey = 'vsChess.game.v1';
const solvedPuzzlesKey = 'vsChess.solvedPuzzles.v1';
const preferencesKey = 'vsChess.preferences.v1';

export class Storage {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly workspace: Memento, private readonly profile: Memento,
    private readonly onError: (error: unknown) => void) {}

  loadGame() { return Game.restore(this.workspace.get(gameKey)); }
  loadPreferences() {
    const value = this.profile.get(preferencesKey);
    const migrated = record(value) && value.language === undefined ? { ...value, language: defaults.language } : value;
    return isPreferences(migrated) ? migrated : { ...defaults };
  }
  loadSolvedPuzzles() {
    const saved = this.profile.get<unknown>(solvedPuzzlesKey);
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string =>
      typeof id === 'string' && /^[A-Za-z0-9]{5}$/.test(id)) : []);
  }
  saveSolvedPuzzles(solved: ReadonlySet<string>) {
    const snapshot = [...solved];
    this.enqueue(() => this.profile.update(solvedPuzzlesKey, snapshot));
  }
  saveGame(game: Game, now: number) {
    const snapshot = game.save(now);
    this.enqueue(() => this.workspace.update(gameKey, snapshot));
  }
  savePreferences(preferences: Preferences) {
    this.enqueue(() => this.profile.update(preferencesKey, preferences));
  }
  private enqueue(write: () => Thenable<void>) {
    this.pending = this.pending.then(write).catch(this.onError);
  }
  flush() { return this.pending; }
}
