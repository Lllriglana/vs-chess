import * as vscode from 'vscode';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PuzzlePack, type Puzzle, type PuzzleSession } from '../puzzles/puzzles';
import { defaultPuzzleFilter, type PuzzleFilter } from '../shared/puzzles';
import { Review } from '../analysis/review';
import { Game } from '../chess/game';
import { Stockfish } from '../engine/stockfish';
import { Storage } from '../storage/storage';
import { parseAction, type Action, type Preferences, type Response } from '../shared/protocol';

let provider: ChessView | undefined;

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('VS Chess', { log: true });
  provider = new ChessView(context, log);
  context.subscriptions.push(log,
    vscode.window.registerWebviewViewProvider('vsChess.game', provider),
    provider);
}
export function deactivate() { return provider?.shutdown(); }

class ChessView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly storage: Storage;
  private readonly engine: Stockfish;
  private game?: Game;
  private review?: Review;
  private puzzle?: PuzzleSession;
  private puzzlesOpen = false;
  private puzzles?: PuzzlePack;
  private puzzleFilter = defaultPuzzleFilter;
  private readonly solvedPuzzles: Set<string>;
  private preferences: Preferences;
  private revision = 0;
  private search?: AbortController;
  private alarm?: NodeJS.Timeout;
  private engineError = false;
  private ready = false;
  private closed = false;
  private shutdownResult?: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
    this.storage = new Storage(context.workspaceState, context.globalState, error => {
      this.log.error(String(error));
      this.notice('VS Code could not save your chess session.');
    });
    this.engine = new Stockfish(vscode.Uri.joinPath(context.extensionUri, 'dist', 'stockfish-19-lite-single.js').fsPath);
    this.game = this.storage.loadGame();
    this.solvedPuzzles = this.storage.loadSolvedPuzzles();
    this.preferences = this.storage.loadPreferences();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.ready = false;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const listeners = [
      view.webview.onDidReceiveMessage(raw => {
        if (this.view !== view || this.closed) return;
        const action = parseAction(raw);
        if (action) this.handle(action);
      }),
      view.onDidChangeVisibility(() => {
        if (this.view !== view || this.closed) return;
        if (!view.visible) this.suspend();
        else if (this.ready) this.handle({ type: 'ready' });
      })
    ];
    view.onDidDispose(() => {
      for (const listener of listeners) listener.dispose();
      if (this.view !== view) return;
      this.suspend();
      this.view = undefined;
      this.ready = false;
    });
    const nonce = randomBytes(24).toString('base64');
    const resource = (file: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(dist, file));
    view.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${view.webview.cspSource}; img-src ${view.webview.cspSource}; base-uri 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${resource('webview.css')}">
  <title>VS Chess</title>
</head>
<body>
  <main id="app"><p>Loading VS Chess…</p></main>
  <script nonce="${nonce}" src="${resource('webview.js')}"></script>
</body>
</html>`;
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
  }

  private get active() { return this.ready && this.view?.visible === true && !this.closed; }
  private post(response: Response) {
    if (this.active) void this.view?.webview.postMessage(response);
  }
  private notice(message: string) { this.post({ type: 'notice', message }); }
  private state() {
    if (this.review) {
      this.post({ type: 'state', state: {
        preferences: this.preferences, position: this.review.view(this.preferences, this.revision), review: this.review.info()
      } });
      return;
    }
    if (this.puzzlesOpen && this.puzzle) {
      const puzzle = this.puzzle;
      this.post({ type: 'state', state: {
        preferences: this.preferences,
        position: puzzle.view(this.preferences, this.revision),
        puzzle: { id: puzzle.id, rating: puzzle.rating, status: puzzle.status,
          filter: this.puzzleFilter, hint: puzzle.hint, solved: this.solvedPuzzles.size }
      } });
      return;
    }
    this.post({ type: 'state', state: {
      preferences: this.preferences,
      position: this.game?.view(this.preferences, this.revision, !!this.search, this.engineError)
    } });
  }
  private save(now: number) {
    if (this.game) this.storage.saveGame(this.game, now);
  }
  private cancelSearch() {
    const search = this.search;
    this.search = undefined;
    search?.abort();
  }
  private suspend() {
    this.cancelSearch();
    clearTimeout(this.alarm);
    if (this.game?.deadline === undefined) return;
    const now = Date.now();
    if (this.game.expire(now)) this.revision++;
    this.game.pause(now);
    this.save(now);
  }
  private scheduleClock(now: number) {
    clearTimeout(this.alarm);
    const deadline = this.game?.deadline;
    if (!this.active || this.puzzlesOpen || deadline === undefined) return;
    this.alarm = setTimeout(() => {
      const current = Date.now();
      if (this.game?.expire(current)) this.changed(current);
      else this.scheduleClock(current);
    }, Math.max(1, deadline - now));
    this.alarm.unref();
  }
  private scheduleBot() {
    const game = this.game;
    if (!this.active || this.puzzlesOpen || this.review || !game?.botTurn || this.search || this.engineError) return;
    const now = Date.now();
    if (game.claim(now)) {
      this.revision++;
      this.save(now);
      return;
    }
    const controller = new AbortController();
    this.search = controller;
    void this.engine.search(game.enginePosition(), this.preferences, controller.signal).then(move => {
      if (this.search !== controller) return;
      this.search = undefined;
      const current = Date.now();
      if (!game.play(move, current)) throw new Error('Stockfish move did not match the active position');
      this.changed(current);
    }).catch(error => {
      if (!this.active || controller.signal.aborted) return;
      if (this.search === controller) this.search = undefined;
      this.log.error(String(error));
      this.engineError = true;
      this.state();
    });
  }
  private changed(now: number) {
    this.revision++;
    this.engineError = false;
    this.save(now);
    this.scheduleClock(now);
    this.scheduleBot();
    this.state();
  }
  private nextPuzzle(filter: PuzzleFilter, now: number) {
    try {
      if (!this.puzzles) {
        const file = vscode.Uri.joinPath(this.context.extensionUri, 'data', 'puzzles.json').fsPath;
        this.puzzles = new PuzzlePack(JSON.parse(readFileSync(file, 'utf8')) as Puzzle[]);
      }
      const next = this.puzzles.next(filter, this.solvedPuzzles, this.puzzle?.id);
      if (!next) {
        this.notice('No other puzzles match these filters.');
        return;
      }
      this.puzzle = next;
      this.puzzleFilter = filter;
      this.openPuzzles(now);
    } catch (error) {
      this.log.error(String(error));
      this.notice('Could not open the puzzle pack.');
    }
  }
  private openPuzzles(now: number) {
    if (!this.puzzle) {
      this.nextPuzzle(this.puzzleFilter, now);
      return;
    }
    if (!this.puzzlesOpen) this.suspend();
    this.puzzlesOpen = true;
    this.revision++;
    this.state();
  }
  private handlePuzzle(action: Action) {
    const puzzle = this.puzzle;
    if (!puzzle || !('revision' in action) || action.revision !== this.revision) {
      this.state();
      return;
    }
    switch (action.type) {
      case 'move':
        if (!puzzle.solveMove(action.move)) {
          this.notice('Try another move.');
          return;
        }
        if (puzzle.status === 'solved' && !this.solvedPuzzles.has(puzzle.id)) {
          this.solvedPuzzles.add(puzzle.id);
          this.storage.saveSolvedPuzzles(this.solvedPuzzles);
        }
        break;
      case 'puzzleHint':
        puzzle.showHint();
        this.state();
        return;
      case 'puzzleReveal': puzzle.reveal(); break;
      case 'puzzleRetry': this.puzzle = puzzle.retry(); break;
      default: return;
    }
    this.revision++;
    this.state();
  }
  private scheduleReview() {
    const review = this.review;
    if (!this.active || !review || this.search || review.hasLines || review.failed || review.terminal) return;
    const controller = new AbortController();
    this.search = controller;
    const position = review.enginePosition;
    const playedMove = review.playedMove;
    void this.engine.analyze(position, controller.signal).then(async lines => {
      if (this.search !== controller) return;
      let playedLine;
      if (playedMove && !lines.some(line => line.moves[0] === playedMove)) {
        try { [playedLine] = await this.engine.analyze(position, controller.signal, playedMove); }
        catch (error) { if (!controller.signal.aborted) this.log.error(String(error)); }
      }
      if (this.search !== controller) return;
      review.accept(lines, playedLine);
      this.search = undefined;
      this.state();
    }).catch(error => {
      if (this.search !== controller || controller.signal.aborted) return;
      this.search = undefined;
      review.failed = true;
      this.log.error(String(error));
      this.state();
    });
  }
  private handleReview(action: Action) {
    const review = this.review;
    if (!review) return;
    switch (action.type) {
      case 'reviewClose':
        this.cancelSearch();
        this.review = undefined;
        break;
      case 'reviewSeek':
        if (!review.seek(action.ply)) return;
        this.cancelSearch();
        break;
      case 'reviewPreview':
        if (!review.show(action.line, action.step)) return;
        break;
      case 'reviewRetry':
        review.failed = false;
        break;
      default: return;
    }
    this.revision++;
    this.scheduleReview();
    this.state();
  }
  private handle(action: Action) {
    const now = Date.now();
    if (action.type === 'ready') {
      this.ready = true;
      if (!this.active) return;
      if (!this.puzzlesOpen && !this.review) this.game?.resume(now);
      this.scheduleClock(now);
      this.scheduleBot();
      this.scheduleReview();
      this.state();
      return;
    }
    if (!this.active) return;
    if (this.review && action.type !== 'settings') {
      this.handleReview(action);
      return;
    }
    if (action.type === 'reviewOpen') {
      if (!this.game?.result || this.puzzlesOpen) return;
      this.cancelSearch();
      this.review = new Review(this.game.save(now), this.game.view(this.preferences, this.revision, false, false));
      this.revision++;
      this.scheduleReview();
      this.state();
      return;
    }
    if (action.type === 'puzzleOpen') {
      this.openPuzzles(now);
      return;
    }
    if (action.type === 'puzzleClose') {
      if (!this.puzzlesOpen) return;
      this.puzzlesOpen = false;
      this.revision++;
      this.game?.resume(now);
      this.scheduleClock(now);
      this.scheduleBot();
      this.state();
      return;
    }
    if (action.type === 'puzzleNext') {
      if (this.puzzlesOpen) this.nextPuzzle(action.filter, now);
      return;
    }
    if (action.type === 'settings') {
      const changedEngine = action.preferences.level !== this.preferences.level
        || action.preferences.thinkMs !== this.preferences.thinkMs;
      this.preferences = action.preferences;
      this.storage.savePreferences(this.preferences);
      if (changedEngine && !this.review) {
        this.engineError = false;
        this.cancelSearch();
        this.scheduleBot();
      }
      this.state();
      return;
    }
    if (this.puzzlesOpen) {
      this.handlePuzzle(action);
      return;
    }
    if (action.type === 'retry') {
      this.engineError = false;
      this.scheduleBot();
      this.state();
      return;
    }
    if (!('revision' in action) || action.revision !== (this.game ? this.revision : null)) {
      this.state();
      this.notice('The position changed. Try again.');
      return;
    }
    if (action.type === 'start') {
      this.cancelSearch();
      const setup = action.setup;
      this.game = new Game(setup.randomColor ? { ...setup, color: randomInt(2) === 0 ? 'w' : 'b' } : setup);
      this.game.resume(now);
      this.changed(now);
      return;
    }
    const game = this.game;
    if (!game) return;
    if (game.expire(now)) {
      this.changed(now);
      return;
    }
    if (action.type === 'flip') {
      game.flipBoard();
      this.save(now);
      this.state();
      return;
    }
    let changed = false;
    switch (action.type) {
      case 'undo': changed = game.undo(now, true); break;
      case 'move': changed = !game.botTurn && game.play(action.move, now); break;
      case 'claim': changed = !game.botTurn && game.claim(now); break;
      case 'claimMove': changed = !game.botTurn && game.claim(now, action.move); break;
      case 'resign': changed = game.resign(now); break;
      case 'agree': changed = game.agree(now); break;
    }
    if (changed) {
      this.cancelSearch();
      this.changed(now);
    } else {
      this.state();
      this.notice(action.type === 'claimMove' ? 'That move does not qualify for a draw claim.' : 'This action is unavailable.');
    }
  }
  shutdown() {
    if (this.shutdownResult) return this.shutdownResult;
    this.closed = true;
    this.suspend();
    this.shutdownResult = this.storage.flush();
    return this.shutdownResult;
  }
  dispose() { void this.shutdown(); }
}
