import type { Color, PieceSymbol, Square } from 'chess.js';
import {
  controls, levels, parseResponse, pieceStyles, themes, times,
  type Action, type MoveInput, type Position, type Preferences, type Setup, type State
} from '../shared/protocol';
import { figurine, names } from '../themes/pieces';

declare function acquireVsCodeApi(): {
  postMessage(message: Action): void;
};

const vscode = acquireVsCodeApi();
const app = document.querySelector<HTMLElement>('#app')!;
const files = 'abcdefgh';
const colorName = { w: 'White', b: 'Black' };
const titleCase = (name: string) => name[0].toUpperCase() + name.slice(1);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state: State | undefined;
let previous: Position | undefined;
let home: HTMLElement | undefined;
let game: GameElements | undefined;
let selected: Square | undefined;
let focused: Square | undefined;
let dragged: Square | undefined;
let claimMove = false;
let clockInterval: number | undefined;
let noticeTimeout: number | undefined;
let modalRevision: number | undefined;
let handshakeTimeout: number | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}
function button(label: string, action: () => void, className = 'secondary') {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function group(className: string, ...children: Node[]) {
  const div = element('div', className);
  div.append(...children);
  return div;
}

const notice = element('div', 'notice');
notice.setAttribute('role', 'status');
notice.hidden = true;
const screen = element('div', 'screen');
const dialog = element('dialog');
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener('close', () => {
  modalRevision = undefined;
  dialog.replaceChildren();
});
app.replaceChildren(screen, notice, dialog);

function showNotice(message: string) {
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimeout = window.setTimeout(() => { notice.hidden = true; }, 3800);
}
function openDialog(title: string, ...nodes: HTMLElement[]) {
  const heading = element('h2', '', title);
  heading.id = 'dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.replaceChildren(group('dialog-content', heading, ...nodes));
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLElement>('select, input, button')?.focus();
}
function selectField<T>(label: string, options: readonly T[], selectedValue: T, display: (value: T) => string) {
  const select = element('select');
  select.setAttribute('aria-label', label);
  for (const [index, value] of options.entries()) {
    const option = element('option', '', display(value));
    option.value = String(index);
    option.selected = value === selectedValue;
    select.append(option);
  }
  const wrapper = element('label', 'field');
  wrapper.append(element('span', '', label), select);
  return { wrapper, value: () => options[select.selectedIndex] };
}
function submitForm(save: () => void, label: string, ...fields: HTMLElement[]) {
  const form = element('form');
  const submit = element('button', 'primary', label);
  submit.type = 'submit';
  form.append(...fields, group('dialog-actions', button('Cancel', () => dialog.close()), submit));
  form.addEventListener('submit', event => { event.preventDefault(); save(); });
  return form;
}

function showSettings() {
  const preferences = state?.preferences;
  if (!preferences) return;
  const theme = selectField('Board', themes, preferences.theme, titleCase);
  const pieces = selectField('Pieces', pieceStyles, preferences.pieces, value => value === 'letter' ? 'Letters' : 'Figurines');
  const level = selectField('Stockfish level', levels.map((_, index) => index), preferences.level,
    index => `${levels[index].label} · ${levels[index].rating}`);
  const think = selectField('Thinking time', times, preferences.thinkMs, ms => `${ms / 1000} s`);
  const flip = element('input');
  flip.type = 'checkbox';
  flip.checked = preferences.autoFlip;
  const check = element('label', 'checkbox');
  check.append(flip, 'Auto-flip in two-player games');
  const form = submitForm(() => {
    const next: Preferences = {
      theme: theme.value(), pieces: pieces.value(), level: level.value(), thinkMs: think.value(), autoFlip: flip.checked
    };
    vscode.postMessage({ type: 'settings', preferences: next });
    dialog.close();
  }, 'Save settings', theme.wrapper, pieces.wrapper, check, level.wrapper, think.wrapper,
  element('p', 'hint', 'Difficulty ratings are approximate.'));
  openDialog('Settings', form);
}
function start(setup: Setup, revision: number | null) {
  vscode.postMessage({ type: 'start', setup, revision });
  dialog.close();
}
function showSetup(mode: Setup['mode']) {
  const existing = state?.position;
  const revision = existing?.revision ?? null;
  const color = selectField('Play as', ['w', 'b'] as const, existing?.setup.color ?? 'w', value => colorName[value]);
  const control = selectField('Time control', controls, existing?.setup.control ?? 'off',
    value => value === 'off' ? 'Untimed' : value.replace('+', ' + '));
  const form = submitForm(() => start({
    mode, color: mode === 'computer' ? color.value() : 'w', control: mode === 'local' ? control.value() : 'off'
  }, revision), 'Start game', mode === 'computer' ? color.wrapper : control.wrapper);
  const hint = element('p', 'hint', mode === 'computer'
    ? 'Change Stockfish strength and thinking time in Settings.'
    : 'Time controls show minutes per player plus seconds added after each move.');
  if (existing && !existing.result) form.prepend(element('p', 'hint', 'Starting replaces the current game.'));
  openDialog(mode === 'computer' ? 'Play Stockfish' : 'Two players', hint, form);
}
function showNewGame() {
  const position = state?.position;
  if (!position) return;
  const setup = position.setup;
  const hint = position.result ? 'Choose a mode or replay with the same setup.' : 'A new game replaces the current game.';
  openDialog('New game', element('p', 'hint', hint), group('mode-stack',
    button('Play Stockfish', () => showSetup('computer')),
    button('Two players', () => showSetup('local')),
    button('Restart same setup', () => start(setup, position.revision)),
    button('Cancel', () => dialog.close(), 'quiet')));
}
function command(type: 'undo' | 'flip' | 'claim' | 'resign' | 'agree') {
  const position = state?.position;
  if (position) vscode.postMessage({ type, revision: position.revision });
}
function confirmAction(type: 'resign' | 'agree') {
  const isDraw = type === 'agree';
  openDialog(isDraw ? 'Agree to a draw?' : 'Resign this game?',
    element('p', 'hint', isDraw ? 'Confirm only if both players have agreed.' : 'The other player wins the game.'),
    group('dialog-actions', button('Cancel', () => dialog.close()),
      button(isDraw ? 'Agree' : 'Resign', () => { command(type); dialog.close(); }, 'primary')));
}

function renderHome() {
  if (!home) {
    const mark = group('home-mark', figurine('n', 'w'));
    home = group('home', mark, element('h1', '', 'VS Chess'),
      element('p', 'home-subtitle', 'Play a game in your sidebar.'),
      group('home-actions',
        button('Play Stockfish', () => showSetup('computer'), 'primary'),
        button('Two players', () => showSetup('local')),
        button('Settings', showSettings, 'quiet')));
  }
  if (screen.firstChild !== home) screen.replaceChildren(home);
}

type Tile = { button: HTMLButtonElement; artwork: HTMLElement; marker: string };
type PlayerRow = { row: HTMLElement; icon: HTMLElement; name: HTMLElement; role: HTMLElement; clock: HTMLElement };
type GameElements = ReturnType<typeof createGame>;

function playerRow() {
  const icon = element('span', 'player-icon');
  icon.setAttribute('aria-hidden', 'true');
  const name = element('strong');
  const role = element('span', 'player-role');
  const clock = element('span', 'clock');
  const row = group('player', icon, group('player-label', name, role), clock);
  return { row, icon, name, role, clock };
}
function createGame() {
  const top = playerRow();
  const bottom = playerRow();
  const board = element('div', 'board');
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'Chessboard. Use arrow keys to navigate and Enter to select a square.');
  board.addEventListener('keydown', boardKeys);
  board.addEventListener('dragend', () => { dragged = undefined; });
  const status = element('div', 'game-status');
  status.setAttribute('role', 'status');
  const toolStatus = element('div', 'tool-status');
  const retry = button('Retry Stockfish', () => vscode.postMessage({ type: 'retry' }));
  const undo = button('Undo', () => command('undo'));
  const history = element('details', 'history');
  const historySummary = element('summary', '', 'Moves');
  const moveList = element('ol', 'moves');
  const noMoves = element('p', 'hint', 'Moves will appear here.');
  history.append(historySummary, noMoves, moveList);
  const more = element('details', 'more');
  const claim = button('Claim draw', () => command('claim'), 'quiet');
  const intended = button('Claim with a move', () => {
    claimMove = !claimMove;
    selected = undefined;
    refreshGame();
  }, 'quiet');
  const agree = button('Agree draw', () => confirmAction('agree'), 'quiet');
  const resign = button('Resign', () => confirmAction('resign'), 'quiet');
  more.append(element('summary', '', 'Game options'), group('more-actions', claim, intended, agree, resign));
  const root = group('game', top.row, board, bottom.row, status, toolStatus, retry,
    group('toolbar', button('New Game', showNewGame), undo, button('Flip', () => command('flip')),
      button('Settings', showSettings)), history, more);
  return {
    root, top, bottom, board, status, toolStatus, retry, undo, historySummary, moveList, noMoves,
    more, claim, intended, agree, resign, tiles: new Map<Square, Tile>(), squares: [] as Square[],
    flipped: undefined as boolean | undefined, historyKey: ''
  };
}

function tilePiece(type: PieceSymbol, color: Color, style: Preferences['pieces']) {
  if (style === 'figurine') return figurine(type, color);
  const letter = element('span', `piece-letter ${color}`, type.toUpperCase());
  letter.setAttribute('aria-hidden', 'true');
  return letter;
}
function rebuildBoard(position: Position, elements: GameElements) {
  const restoreFocus = elements.board.contains(document.activeElement);
  elements.tiles.clear();
  elements.squares = [];
  elements.flipped = position.flipped;
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = `${files[position.flipped ? 7 - col : col]}${position.flipped ? row + 1 : 8 - row}` as Square;
      const tile = button('', () => {
        focused = square;
        activateSquare(square);
      }, `square ${(row + col) % 2 ? 'dark' : 'light'}`);
      tile.dataset.square = square;
      const artwork = element('span', 'artwork');
      tile.append(artwork, element('span', 'target'));
      if (col === 0) tile.append(element('span', 'coordinate rank', square[1]));
      if (row === 7) tile.append(element('span', 'coordinate file', square[0]));
      tile.addEventListener('focus', () => { focused = square; syncTabIndex(); });
      tile.addEventListener('dragstart', event => {
        if (!state?.position?.legal.some(move => move.from === square)) {
          event.preventDefault();
          return;
        }
        dragged = square;
        selected = square;
        event.dataTransfer?.setData('text/plain', square);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        updateBoard(state.position, elements);
      });
      tile.addEventListener('dragover', event => {
        if (dragged && state?.position?.legal.some(move => move.from === dragged && move.to === square)) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        }
      });
      tile.addEventListener('drop', event => {
        if (!dragged) return;
        event.preventDefault();
        selected = dragged;
        dragged = undefined;
        activateSquare(square);
      });
      elements.tiles.set(square, { button: tile, artwork, marker: '' });
      elements.squares.push(square);
      fragment.append(tile);
    }
  }
  elements.board.replaceChildren(fragment);
  focused ??= position.flipped ? 'e7' : 'e2';
  syncTabIndex();
  if (restoreFocus) elements.tiles.get(focused)?.button.focus();
}
function syncTabIndex() {
  if (!game) return;
  for (const [square, tile] of game.tiles) tile.button.tabIndex = square === focused ? 0 : -1;
}
function boardKeys(event: KeyboardEvent) {
  if (!game || !focused) return;
  if (event.key === 'Escape') {
    selected = undefined;
    claimMove = false;
    refreshGame();
    return;
  }
  const index = game.squares.indexOf(focused);
  const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
  const step = directions[event.key];
  if (step === undefined) return;
  event.preventDefault();
  if ((step === -1 && index % 8 === 0) || (step === 1 && index % 8 === 7)) return;
  const destination = game.squares[index + step];
  if (destination) game.tiles.get(destination)?.button.focus();
}

function submitMove(move: MoveInput, revision: number) {
  vscode.postMessage({ type: claimMove ? 'claimMove' : 'move', move, revision });
  claimMove = false;
  selected = undefined;
  refreshGame();
}
function activateSquare(square: Square) {
  const position = state?.position;
  if (!position) return;
  const options = position.legal.filter(move => move.from === selected && move.to === square);
  if (options.length === 1) return submitMove(options[0], position.revision);
  if (options.length > 1) {
    modalRevision = position.revision;
    const choices = options.map(move => {
      const promotion = move.promotion!;
      const choice = button(titleCase(names[promotion]), () => {
        submitMove(move, position.revision);
        dialog.close();
      }, 'promotion secondary');
      choice.prepend(tilePiece(promotion, position.turn, state!.preferences.pieces));
      return choice;
    });
    openDialog('Promote pawn', group('promotion-grid', ...choices),
      button('Cancel', () => dialog.close(), 'quiet'));
    return;
  }
  selected = selected !== square && position.legal.some(move => move.from === square) ? square : undefined;
  refreshGame();
}

function animate(position: Position, before: Position, elements: GameElements) {
  const last = position.last;
  if (!last || position.history.length !== before.history.length + 1 || reduceMotion.matches) return;
  const animatePiece = (from: Square, to: Square) => {
    const origin = elements.tiles.get(from)?.button;
    const destination = elements.tiles.get(to);
    if (!origin || !destination) return;
    const a = origin.getBoundingClientRect();
    const b = destination.button.getBoundingClientRect();
    destination.artwork.animate([
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px)`, zIndex: 3 },
      { transform: 'translate(0, 0)', zIndex: 3 }
    ], { duration: 150, easing: 'ease-out' });
  };
  animatePiece(last.from, last.to);
  if (before.pieces[last.from]?.type === 'k' && last.from[0] === 'e') {
    const rank = last.from[1];
    if (last.to[0] === 'g') animatePiece(`h${rank}` as Square, `f${rank}` as Square);
    if (last.to[0] === 'c') animatePiece(`a${rank}` as Square, `d${rank}` as Square);
  }
}

function updateBoard(position: Position, elements: GameElements) {
  const preferences = state!.preferences;
  const targets = new Set(position.legal.filter(move => move.from === selected).map(move => move.to));
  const origins = new Set(position.legal.map(move => move.from));
  for (const [square, tile] of elements.tiles) {
    const { button: squareButton, artwork } = tile;
    const piece = position.pieces[square];
    const marker = piece ? piece.color + piece.type + preferences.pieces : '-';
    if (marker !== tile.marker) {
      artwork.replaceChildren(...(piece ? [tilePiece(piece.type, piece.color, preferences.pieces)] : []));
      tile.marker = marker;
    }
    const isTarget = targets.has(square);
    squareButton.classList.toggle('selected', square === selected);
    squareButton.classList.toggle('last', square === position.last?.from || square === position.last?.to);
    squareButton.classList.toggle('in-check', square === position.check);
    squareButton.classList.toggle('can-move', origins.has(square));
    squareButton.classList.toggle('target-empty', isTarget && !piece);
    squareButton.classList.toggle('target-capture', isTarget && !!piece);
    squareButton.draggable = origins.has(square);
    squareButton.setAttribute('aria-label', [square, piece && `${colorName[piece.color]} ${names[piece.type]}`,
      isTarget && 'legal destination', square === position.check && 'in check'].filter(Boolean).join(', '));
    squareButton.setAttribute('aria-pressed', String(square === selected));
  }
}

function renderPlayer(row: PlayerRow, color: Color, position: Position) {
  const isComputer = position.setup.mode === 'computer';
  row.name.textContent = isComputer ? color === position.setup.color ? 'You' : 'Stockfish' : colorName[color];
  row.role.textContent = isComputer ? colorName[color] : position.result ? '' : color === position.turn ? 'To move' : '';
  if (row.icon.dataset.color !== color) {
    row.icon.dataset.color = color;
    row.icon.replaceChildren(figurine('k', color));
  }
  row.row.classList.toggle('active-player', color === position.turn && !position.result);
  row.clock.hidden = !position.clock;
}
function renderHistory(position: Position, elements: GameElements) {
  const key = position.history.join(' ');
  if (key === elements.historyKey) return;
  elements.historyKey = key;
  const list = document.createDocumentFragment();
  for (let index = 0; index < position.history.length; index += 2) {
    const li = element('li', 'move-pair');
    li.append(element('span', 'move-index', `${index / 2 + 1}.`),
      element('span', '', position.history[index]), element('span', '', position.history[index + 1] ?? ''));
    list.append(li);
  }
  elements.moveList.replaceChildren(list);
  elements.moveList.scrollTop = elements.moveList.scrollHeight;
  elements.noMoves.hidden = position.history.length > 0;
  const rounds = Math.ceil(position.history.length / 2);
  elements.historySummary.textContent = rounds ? `Moves (${rounds})` : 'Moves';
}
function renderClocks() {
  const position = state?.position;
  if (!game || !position?.clock) return;
  const { clock } = position;
  for (const [row, color] of [[game.top, position.flipped ? 'w' : 'b'],
    [game.bottom, position.flipped ? 'b' : 'w']] as const) {
    const elapsed = position.turn === color && clock.startedAt !== null
      ? Math.max(0, Date.now() - clock.startedAt) : 0;
    const seconds = Math.ceil(Math.max(0, clock.remaining[color] - elapsed) / 1000);
    const display = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (row.clock.textContent !== display) row.clock.textContent = display;
    row.clock.classList.toggle('low', seconds <= 15);
  }
}
function refreshGame(animateFrom?: Position) {
  const position = state?.position;
  if (!game || !position) return;
  const elements = game;
  if (position.flipped !== elements.flipped) rebuildBoard(position, elements);
  updateBoard(position, elements);
  if (animateFrom && animateFrom.flipped === position.flipped) animate(position, animateFrom, elements);
  renderPlayer(elements.top, position.flipped ? 'w' : 'b', position);
  renderPlayer(elements.bottom, position.flipped ? 'b' : 'w', position);
  const result = position.result;
  const resultLabel = result?.winner ? `${colorName[result.winner]} wins` : 'Draw';
  const turn = position.thinking ? 'Stockfish is thinking…' : `${colorName[position.turn]} to move`;
  const label = result ? `${resultLabel} · ${result.reason}` : turn + (position.check ? ' · Check' : '');
  if (elements.status.textContent !== label) elements.status.textContent = label;
  elements.status.classList.toggle('ended', Boolean(result));
  elements.toolStatus.hidden = !claimMove && !position.engineError;
  elements.toolStatus.textContent = claimMove ? 'Choose the move you want to claim with.' : 'Stockfish could not complete its move.';
  elements.retry.hidden = !position.engineError;
  elements.undo.disabled = !position.canUndo;
  elements.claim.hidden = !position.claim;
  elements.intended.hidden = position.legal.length === 0;
  elements.intended.textContent = claimMove ? 'Cancel draw claim' : 'Claim with a move';
  elements.agree.hidden = position.setup.mode !== 'local' || Boolean(result);
  elements.resign.hidden = Boolean(result);
  elements.more.hidden = Boolean(result);
  renderHistory(position, elements);
  renderClocks();
  const running = !document.hidden && position.clock?.startedAt != null;
  if (running && clockInterval === undefined) clockInterval = window.setInterval(renderClocks, 200);
  if (!running && clockInterval !== undefined) {
    window.clearInterval(clockInterval);
    clockInterval = undefined;
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const response = parseResponse(event.data);
  if (!response) return;
  if (response.type === 'notice') return showNotice(response.message);
  clearTimeout(handshakeTimeout);
  state = response.state;
  document.body.dataset.boardTheme = state.preferences.theme;
  const position = state.position;
  if (!position) return renderHome();
  if (!game) {
    game = createGame();
    screen.replaceChildren(game.root);
  }
  if (previous?.revision !== position.revision) {
    selected = undefined;
    claimMove = false;
    if (modalRevision !== undefined && modalRevision !== position.revision) dialog.close();
  }
  refreshGame(previous?.revision !== position.revision ? previous : undefined);
  previous = position;
});
document.addEventListener('visibilitychange', () => refreshGame());
function requestState(attempt = 0) {
  vscode.postMessage({ type: 'ready' });
  if (attempt < 3) handshakeTimeout = window.setTimeout(() => requestState(attempt + 1), 500);
}
requestState();
