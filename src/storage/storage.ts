import type { Memento } from 'vscode';
import { Game } from '../chess/game';
import { defaults, isPreferences, type Preferences } from '../shared/protocol';

const gameKey = 'vsChess.game.v1';
const preferencesKey = 'vsChess.preferences.v1';

export class Storage {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly workspace: Memento, private readonly profile: Memento,
    private readonly onError: (error: unknown) => void) {}

  loadGame() { return Game.restore(this.workspace.get(gameKey)); }
  loadPreferences() {
    const value = this.profile.get(preferencesKey);
    return isPreferences(value) ? value : { ...defaults };
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
