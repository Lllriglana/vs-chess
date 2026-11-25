import { formatEvaluation, type ReviewInfo } from '../shared/analysis';
import type { Color, PieceSymbol, Square } from 'chess.js';
import {
  controls, levels, levelOrder, parseResponse, pieceStyles, themes, times,
  type Action, type MoveInput, type Position, type Preferences, type Setup, type State
} from '../shared/protocol';
import {
  puzzleDifficulties, puzzleDifficultyLabels, puzzleThemes, puzzleThemeLabels
} from '../shared/puzzles';
import { figurine, names } from '../themes/pieces';
import { languages, languageNames, type Language } from '../shared/languages';
import { translate } from './translations';

declare function acquireVsCodeApi(): {
  postMessage(message: Action): void;
};

const vscode = acquireVsCodeApi();
const app = document.querySelector<HTMLElement>('#app')!;
const files = 'abcdefgh';
const colorName = { w: 'White', b: 'Black' };
let language: Language = 'en';
const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values);
const titleCase = (name: string) => name[0].toLocaleUpperCase(language) + name.slice(1);
const turnLabel = (color: Color) => t(color === 'w' ? 'White to move' : 'Black to move');
function levelLabel(index: number) {
  const level = levels[index];
  return level.rating === null ? t('Maximum · unrestricted') : `${t(level.label)} · ≈${level.rating} Elo`;
}
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
  const node = element('button', className, t(label));
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
  notice.textContent = t(message);
  notice.hidden = false;
  noticeTimeout = window.setTimeout(() => { notice.hidden = true; }, 3800);
}
function openDialog(title: string, ...nodes: HTMLElement[]) {
  const heading = element('h2', '', t(title));
  heading.id = 'dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.replaceChildren(group('dialog-content', heading, ...nodes));
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLElement>('select, input, button')?.focus();
}
function selectField<T>(label: string, options: readonly T[], selectedValue: T, display: (value: T) => string) {
  const select = element('select');
  select.setAttribute('aria-label', t(label));
  for (const [index, value] of options.entries()) {
    const option = element('option', '', t(display(value)));
    option.value = String(index);
    option.selected = value === selectedValue;
    select.append(option);
  }
  const wrapper = element('label', 'field');
  wrapper.append(element('span', '', t(label)), select);
  return { wrapper, value: () => options[select.selectedIndex] };
}
function submitForm(save: () => void, label: string, ...fields: HTMLElement[]) {
  const form = element('form');
  const submit = element('button', 'primary', t(label));
  submit.type = 'submit';
  form.append(...fields, group('dialog-actions', button('Cancel', () => dialog.close()), submit));
  form.addEventListener('submit', event => { event.preventDefault(); save(); });
  return form;
}

function showSettings() {
  const preferences = state?.preferences;
  if (!preferences) return;
  const locale = selectField('Language', languages, preferences.language, value => languageNames[value]);
  const theme = selectField('Board', themes, preferences.theme, titleCase);
  const pieces = selectField('Pieces', pieceStyles, preferences.pieces, value => value === 'letter' ? 'Letters' : 'Figurines');
  const level = selectField('Stockfish level', levelOrder, preferences.level, levelLabel);
  const think = selectField('Thinking time', times, preferences.thinkMs, ms => t('{seconds} s', { seconds: ms / 1000 }));
  const flip = element('input');
  flip.type = 'checkbox';
  flip.checked = preferences.autoFlip;
  const check = element('label', 'checkbox');
  check.append(flip, t('Auto-flip in two-player games'));
  const form = submitForm(() => {
    const next: Preferences = {
      language: locale.value(), theme: theme.value(), pieces: pieces.value(), level: level.value(),
      thinkMs: think.value(), autoFlip: flip.checked
    };
    vscode.postMessage({ type: 'settings', preferences: next });
    dialog.close();
  }, 'Save settings', locale.wrapper, theme.wrapper, pieces.wrapper, check, level.wrapper, think.wrapper,
  element('p', 'hint', t('Difficulty ratings are approximate.')));
  openDialog('Settings', form);
}
function start(setup: Setup, revision: number | null) {
  vscode.postMessage({ type: 'start', setup, revision });
  dialog.close();
}
function showSetup(mode: Setup['mode']) {
  const existing = state?.position;
  const color = selectField('Play as', ['w', 'b', 'random'] as const,
    existing?.setup.randomColor ? 'random' : existing?.setup.color ?? 'w',
    value => value === 'random' ? 'Random' : colorName[value]);
  const control = selectField('Time control', controls, existing?.setup.control ?? 'off',
    value => value === 'off' ? 'Untimed' : value.replace('+', ' + '));
  const form = submitForm(() => {
    const choice = color.value();
    const setup: Setup = { mode, color: choice === 'b' && mode === 'computer' ? 'b' : 'w',
      control: mode === 'local' ? control.value() : 'off' };
    if (mode === 'computer' && choice === 'random') setup.randomColor = true;
    start(setup, state?.position?.revision ?? null);
  }, 'Start game', mode === 'computer' ? color.wrapper : control.wrapper);
  const hint = element('p', 'hint', mode === 'computer'
    ? `${levelLabel(state!.preferences.level)} · ${t('{seconds} s per move', { seconds: state!.preferences.thinkMs / 1000 })}`
    : t('Time controls show minutes per player plus seconds added after each move.'));
  if (existing && !existing.result) form.prepend(element('p', 'hint', t('Starting replaces the current game.')));
  openDialog(mode === 'computer' ? 'Play Stockfish' : 'Two players', hint, form);
}
function showNewGame() {
  const position = state?.position;
  if (!position) return;
  const setup = position.setup;
  const hint = position.result ? 'Choose a mode or replay with the same setup.' : 'A new game replaces the current game.';
  openDialog('New Game', element('p', 'hint', t(hint)), group('mode-stack',
    button('Play Stockfish', () => showSetup('computer')),
    button('Two players', () => showSetup('local')),
    button('Restart same setup', () => start(setup, state?.position?.revision ?? null)),
    button('Cancel', () => dialog.close(), 'quiet')));
}
function command(type: 'undo' | 'flip' | 'claim' | 'resign' | 'agree') {
  const position = state?.position;
  if (position) vscode.postMessage({ type, revision: position.revision });
}
function confirmAction(type: 'resign' | 'agree') {
  const isDraw = type === 'agree';
  openDialog(isDraw ? 'Agree to a draw?' : 'Resign this game?',
    element('p', 'hint', t(isDraw ? 'Confirm only if both players have agreed.' : 'The other player wins the game.')),
    group('dialog-actions', button('Cancel', () => dialog.close()),
      button(isDraw ? 'Agree' : 'Resign', () => { command(type); dialog.close(); }, 'primary')));
}

function puzzleAction(type: 'puzzleHint' | 'puzzleReveal' | 'puzzleRetry') {
  if (state?.puzzle && state.position) vscode.postMessage({ type, revision: state.position.revision });
}
function nextPuzzle() {
  if (state?.puzzle) vscode.postMessage({ type: 'puzzleNext', filter: state.puzzle.filter });
}
function showPuzzleFilters() {
  const filter = state?.puzzle?.filter;
  if (!filter) return;
  const difficulty = selectField('Difficulty', puzzleDifficulties, filter.difficulty, value => puzzleDifficultyLabels[value]);
  const theme = selectField('Theme', puzzleThemes, filter.theme, value => puzzleThemeLabels[value]);
  openDialog('Puzzle filters', submitForm(() => {
    vscode.postMessage({ type: 'puzzleNext', filter: { difficulty: difficulty.value(), theme: theme.value() } });
    dialog.close();
  }, 'Find puzzle', difficulty.wrapper, theme.wrapper));
}
function puzzleButton() {
  return button('Puzzles', () => vscode.postMessage({ type: 'puzzleOpen' }));
}

function renderHome() {
  if (!home) {
    const mark = group('home-mark', figurine('n', 'w'));
    home = group('home', mark, element('h1', '', 'VS Chess'),
      group('home-actions',
        button('Play Stockfish', () => showSetup('computer'), 'primary'),
        button('Two players', () => showSetup('local')), puzzleButton(),
        button('Settings', showSettings, 'quiet')));
  }
  if (screen.firstChild !== home) screen.replaceChildren(home);
}

type Tile = { button: HTMLButtonElement; artwork: HTMLElement; grip: HTMLElement; marker: string };
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
  board.setAttribute('aria-label', t('Chessboard. Use arrow keys to navigate and Enter to select a square.'));
  board.addEventListener('keydown', boardKeys);
  board.addEventListener('dragend', () => { dragged = undefined; });
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.classList.add('review-arrow');
  arrow.setAttribute('viewBox', '0 0 8 8');
  arrow.setAttribute('aria-hidden', 'true');
  const arrowShape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  arrow.append(arrowShape);
  const status = element('div', 'game-status');
  status.setAttribute('role', 'status');
  const toolStatus = element('div', 'tool-status');
  const puzzleDetails = element('span', 'puzzle-details');
  const puzzleHeader = group('puzzle-header',
    button('Back to games', () => vscode.postMessage({ type: 'puzzleClose' }), 'quiet'),
    puzzleDetails);
  const hint = button('Hint', () => puzzleAction('puzzleHint'));
  const reveal = button('Show solution', () => puzzleAction('puzzleReveal'));
  const puzzleRetry = button('Try again', () => puzzleAction('puzzleRetry'));
  const puzzleNext = button('Next puzzle', nextPuzzle, 'primary');
  const puzzleToolbar = group('puzzle-toolbar', hint, reveal, puzzleRetry,
    puzzleNext, button('Filters', showPuzzleFilters), button('Settings', showSettings));
  const solution = element('p', 'puzzle-solution');
  const retry = button('Retry Stockfish', () => vscode.postMessage({ type: 'retry' }));
  const undo = button('Undo', () => command('undo'));
  const analyze = button('Analyze game', () => vscode.postMessage({ type: 'reviewOpen' }), 'primary');
  const reviewAt = element('span', 'review-at');
  const reviewHeader = group('review-header',
    button('Back to game', () => vscode.postMessage({ type: 'reviewClose' }), 'quiet'));
  const seek = (ply: number) => vscode.postMessage({ type: 'reviewSeek', ply });
  function reviewControl(icon: string, label: string, action: () => void) {
    const control = button(icon, action, 'quiet review-control');
    control.setAttribute('aria-label', t(label));
    control.title = t(label);
    return control;
  }
  const reviewStart = reviewControl('⇤', 'Start position', () => seek(0));
  const reviewPrevious = reviewControl('‹', 'Previous', () => { if (state?.review) seek(state.review.ply - 1); });
  const reviewNext = reviewControl('›', 'Next', () => { if (state?.review) seek(state.review.ply + 1); });
  const reviewPlayed = element('p', 'review-played');
  const reviewReset = button('Return to position', () => { if (state?.review) seek(state.review.ply); }, 'quiet');
  const reviewRetry = button('Retry analysis', () => vscode.postMessage({ type: 'reviewRetry' }));
  const reviewNav = group('review-nav', reviewAt, reviewStart, reviewPrevious, reviewNext);
  const reviewLines = element('div', 'review-lines');
  const reviewSelection: { ply?: number; expanded?: number; hovered?: number; focused?: number } = {};
  const history = element('details', 'history');
  const historySummary = element('summary', '', t('Moves'));
  const moveList = element('ol', 'moves');
  const noMoves = element('p', 'hint', t('Moves will appear here.'));
  history.append(historySummary, noMoves, moveList);
  const more = element('details', 'more');
  const claim = button('Claim draw', () => command('claim'), 'quiet');
  const intended = button('Claim draw by move', () => {
    claimMove = !claimMove;
    selected = undefined;
    refreshGame();
  }, 'quiet');
  const agree = button('Agree draw', () => confirmAction('agree'), 'quiet');
  const resign = button('Resign', () => confirmAction('resign'), 'quiet');
  more.append(element('summary', '', t('Draw & resign')), group('more-actions', claim, intended, agree, resign));
  const toolbar = group('toolbar', button('New Game', showNewGame), undo, button('Flip', () => command('flip')),
    button('Settings', showSettings));
  const gameActions = group('game-links', puzzleButton(), more);
  const root = group('game', puzzleHeader, reviewHeader, top.row, board, bottom.row, reviewNav, status, toolStatus, retry,
    analyze, toolbar, puzzleToolbar, solution, reviewRetry, reviewPlayed, reviewLines, reviewReset, history, gameActions);
  return {
    root, top, bottom, board, status, toolStatus, retry, undo, history, historySummary, moveList, noMoves,
    more, claim, intended, agree, resign, toolbar, gameActions,
    analyze, reviewHeader, reviewAt, reviewNav, reviewStart, reviewPrevious, reviewNext,
    reviewReset, reviewRetry, reviewPlayed, reviewLines, reviewSelection, arrow, arrowShape, historyWasOpen: false,
    puzzleHeader, puzzleDetails, puzzleToolbar, hint, reveal, puzzleRetry, puzzleNext, solution, tiles: new Map<Square, Tile>(), squares: [] as Square[],
    flipped: undefined as boolean | undefined, historyKey: ''
  };
}

function tilePiece(type: PieceSymbol, color: Color, style: Preferences['pieces']) {
  if (style === 'figurine') return figurine(type, color);
  const letter = element('span', `piece-letter ${color}`, type.toUpperCase());
  letter.setAttribute('aria-hidden', 'true');
  return letter;
}
function availableMoves(position: Position) {
  return claimMove ? position.claimMoves : position.legal;
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
      const grip = element('span', 'piece-grip');
      artwork.append(grip);
      tile.append(artwork, element('span', 'target'));
      if (col === 0) tile.append(element('span', 'coordinate rank', square[1]));
      if (row === 7) tile.append(element('span', 'coordinate file', square[0]));
      tile.addEventListener('focus', () => { focused = square; syncTabIndex(); });
      grip.addEventListener('dragstart', event => {
        const position = state?.position;
        const transfer = event.dataTransfer;
        if (!position || !transfer || !availableMoves(position).some(move => move.from === square)) {
          event.preventDefault();
          return;
        }
        dragged = square;
        selected = square;
        transfer.setData('application/x-vs-chess-square', square);
        transfer.effectAllowed = 'move';
        const bounds = grip.getBoundingClientRect();
        transfer.setDragImage(grip, bounds.width / 2, bounds.height / 2);
        updateBoard(position, elements);
      });
      tile.addEventListener('dragover', event => {
        const position = state?.position;
        if (dragged && position && availableMoves(position).some(move => move.from === dragged && move.to === square)) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        }
      });
      tile.addEventListener('drop', event => {
        const position = state?.position;
        if (!dragged || !position || !availableMoves(position).some(move => move.from === dragged && move.to === square)) return;
        event.preventDefault();
        selected = dragged;
        dragged = undefined;
        activateSquare(square);
      });
      elements.tiles.set(square, { button: tile, artwork, grip, marker: '' });
      elements.squares.push(square);
      fragment.append(tile);
    }
  }
  elements.board.replaceChildren(fragment, elements.arrow);
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
  const legal = availableMoves(position);
  const options = legal.filter(move => move.from === selected && move.to === square);
  if (options.length === 1) return submitMove(options[0], position.revision);
  if (options.length > 1) {
    modalRevision = position.revision;
    const choices = options.map(move => {
      const promotion = move.promotion!;
      const choice = button(titleCase(t(names[promotion])), () => {
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
  selected = selected !== square && legal.some(move => move.from === square) ? square : undefined;
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
  const legal = availableMoves(position);
  const targets = new Set(legal.filter(move => move.from === selected).map(move => move.to));
  const origins = new Set(legal.map(move => move.from));
  for (const [square, tile] of elements.tiles) {
    const { button: squareButton, grip } = tile;
    const piece = position.pieces[square];
    const marker = piece ? piece.color + piece.type + preferences.pieces : '-';
    if (marker !== tile.marker) {
      grip.replaceChildren(...(piece ? [tilePiece(piece.type, piece.color, preferences.pieces)] : []));
      tile.marker = marker;
    }
    const isTarget = targets.has(square);
    squareButton.classList.toggle('selected', square === selected);
    const puzzleHint = state?.puzzle?.hint === square;
    squareButton.classList.toggle('puzzle-hint', puzzleHint);
    squareButton.classList.toggle('last', square === position.last?.from || square === position.last?.to);
    squareButton.classList.toggle('in-check', square === position.check);
    squareButton.classList.toggle('can-move', origins.has(square));
    squareButton.classList.toggle('target-empty', isTarget && !piece);
    squareButton.classList.toggle('target-capture', isTarget && !!piece);
    grip.draggable = origins.has(square);
    squareButton.setAttribute('aria-label', [square, piece && t('{color} {piece}', { color: t(colorName[piece.color]), piece: t(names[piece.type]) }),
      isTarget && t('legal destination'), puzzleHint && t('Hint'), square === position.check && t('in check')].filter(Boolean).join(', '));
    squareButton.setAttribute('aria-pressed', String(square === selected));
  }
}

function renderPlayer(row: PlayerRow, color: Color, position: Position) {
  const isComputer = position.setup.mode === 'computer';
  row.name.textContent = isComputer ? color === position.setup.color ? t('You') : 'Stockfish' : t(colorName[color]);
  row.role.textContent = isComputer ? t(colorName[color]) : position.result ? '' : color === position.turn ? t('To move') : '';
  if (row.icon.dataset.color !== color) {
    row.icon.dataset.color = color;
    row.icon.replaceChildren(figurine('k', color));
  }
  row.row.classList.toggle('active-player', color === position.turn && !position.result);
  row.row.classList.toggle('mating-player', position.result?.reason === 'Checkmate' && position.result.winner === color);
  row.clock.hidden = !position.clock;
}
function renderHistory(position: Position, elements: GameElements) {
  const review = state?.review;
  const moves = review?.history ?? position.history;
  const key = (review ? 'review ' : 'game ') + moves.join(' ');
  if (key !== elements.historyKey) {
    elements.historyKey = key;
    const list = document.createDocumentFragment();
    function moveCell(index: number) {
      if (!review || !moves[index]) return element('span', '', moves[index] ?? '');
      const step = button(moves[index], () => vscode.postMessage({ type: 'reviewSeek', ply: index + 1 }), 'quiet');
      step.dataset.ply = String(index + 1);
      return step;
    }
    for (let index = 0; index < moves.length; index += 2) {
      const li = element('li', 'move-pair');
      li.append(element('span', 'move-index', `${index / 2 + 1}.`), moveCell(index), moveCell(index + 1));
      list.append(li);
    }
    elements.moveList.replaceChildren(list);
    if (!review) elements.moveList.scrollTop = elements.moveList.scrollHeight;
    elements.noMoves.hidden = moves.length > 0;
    const rounds = Math.ceil(moves.length / 2);
    elements.historySummary.textContent = rounds ? `${t('Moves')} (${rounds})` : t('Moves');
  }
  if (!review) return;
  for (const move of elements.moveList.querySelectorAll<HTMLElement>('[data-ply]')) {
    if (Number(move.dataset.ply) !== review.ply) {
      move.removeAttribute('aria-current');
      continue;
    }
    if (move.hasAttribute('aria-current')) continue;
    move.setAttribute('aria-current', 'step');
    const viewport = elements.moveList.getBoundingClientRect();
    const item = move.getBoundingClientRect();
    if (item.top < viewport.top) elements.moveList.scrollTop -= viewport.top - item.top;
    else if (item.bottom > viewport.bottom) elements.moveList.scrollTop += item.bottom - viewport.bottom;
  }
}

function renderReviewArrow(elements: GameElements) {
  const review = state?.review;
  const selection = elements.reviewSelection;
  const line = review?.preview?.line ?? selection.hovered ?? selection.focused ?? selection.expanded ?? 0;
  const move = review?.lines[line]?.inputs[review.preview?.step ?? 0];
  if (!move) {
    elements.arrow.classList.remove('visible');
    return;
  }
  function center(square: Square) {
    const col = files.indexOf(square[0]);
    const rank = Number(square[1]);
    return elements.flipped ? [7.5 - col, rank - .5] : [col + .5, 8.5 - rank];
  }
  const [x, y] = center(move.from);
  const [toX, toY] = center(move.to);
  const length = Math.hypot(toX - x, toY - y);
  const angle = Math.atan2(toY - y, toX - x) * 180 / Math.PI;
  const head = length - .31;
  elements.arrowShape.setAttribute('transform', `translate(${x} ${y}) rotate(${angle})`);
  elements.arrowShape.setAttribute('points',
    `.19,-.09 ${head},-.09 ${head},-.21 ${length},0 ${head},.21 ${head},.09 .19,.09`);
  elements.arrow.classList.toggle('alternative', line > 0);
  elements.arrow.classList.add('visible');
}

function renderReview(review: ReviewInfo, elements: GameElements) {
  const selection = elements.reviewSelection;
  if (selection.ply !== review.ply) {
    selection.ply = review.ply;
    selection.expanded = selection.hovered = selection.focused = undefined;
  }
  elements.reviewAt.textContent = t('Position {ply} / {total}', { ply: review.ply, total: review.history.length });
  elements.reviewStart.disabled = review.ply === 0 && !review.preview;
  elements.reviewPrevious.disabled = review.ply === 0;
  elements.reviewNext.disabled = review.ply === review.history.length;
  elements.reviewReset.hidden = !review.preview;
  elements.reviewRetry.hidden = review.status !== 'error';
  const previousMove = review.history[review.ply - 1];
  elements.reviewPrevious.title = previousMove ? t('Alternatives to {move}', { move: previousMove }) : t('Previous');
  const nextMove = review.history[review.ply];
  elements.reviewPlayed.hidden = !nextMove || review.playedLine !== undefined || review.status === 'searching';
  elements.reviewPlayed.textContent = nextMove ? t('Played next in the game: {move}', { move: nextMove }) : '';

  const key = JSON.stringify([review.ply, review.lines, review.playedLine]);
  if (elements.reviewLines.dataset.key !== key) {
    elements.reviewLines.dataset.key = key;
    const rows = review.lines.map(({ moves, score, depth }, line) => {
      const details = element('div', 'review-steps');
      const toggle = button('', () => {
        const current = state?.review;
        if (!current) return;
        selection.expanded = selection.expanded === line ? undefined : line;
        if (current.preview) vscode.postMessage({ type: 'reviewSeek', ply: current.ply });
        else renderReview(current, elements);
      }, 'quiet review-line');
      toggle.dataset.line = String(line);
      toggle.title = t('Depth {depth}', { depth });
      const notes = group('review-line-notes');
      if (line === 0) notes.append(element('span', 'review-best', t('Best')));
      if (line === review.playedLine) notes.append(element('span', '', t('Played')));
      const scoreText = element('strong', 'review-score', formatEvaluation(score, language));
      const disclosure = element('span', 'review-disclosure', '›');
      disclosure.setAttribute('aria-hidden', 'true');
      toggle.append(element('strong', '', moves[0]), notes, scoreText, disclosure);
      toggle.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        selection.hovered = line;
        renderReviewArrow(elements);
      });
      toggle.addEventListener('pointerleave', () => {
        if (selection.hovered === line) selection.hovered = undefined;
        renderReviewArrow(elements);
      });
      toggle.addEventListener('focus', () => {
        selection.focused = line;
        renderReviewArrow(elements);
      });
      toggle.addEventListener('blur', () => {
        if (selection.focused === line) selection.focused = undefined;
        renderReviewArrow(elements);
      });
      for (const [index, move] of moves.entries()) {
        const step = index + 1;
        const control = button(move, () => vscode.postMessage({ type: 'reviewPreview', line, step }), 'quiet');
        control.dataset.step = String(step);
        details.append(control);
      }
      return group('review-option', toggle, details);
    });
    elements.reviewLines.replaceChildren(...rows);
  }

  for (const [line, row] of [...elements.reviewLines.children].entries()) {
    const toggle = row.querySelector<HTMLButtonElement>('.review-line')!;
    const details = row.querySelector<HTMLElement>('.review-steps')!;
    const expanded = line === (selection.expanded ?? review.preview?.line);
    toggle.setAttribute('aria-expanded', String(expanded));
    details.hidden = !expanded;
    for (const step of details.querySelectorAll('button')) {
      const selected = line === review.preview?.line && Number(step.dataset.step) === review.preview?.step;
      step.setAttribute('aria-pressed', String(selected));
    }
  }
  renderReviewArrow(elements);
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
  const puzzle = state?.puzzle;
  const review = state?.review;
  const result = position.result;
  let resultLabel = t('Draw');
  if (result?.winner) {
    resultLabel = position.setup.mode === 'local' ? t(result.winner === 'w' ? 'White wins' : 'Black wins')
      : t(result.winner === position.setup.color ? 'You win' : 'Stockfish wins');
  }
  const turn = position.thinking ? t('Stockfish is thinking…') : turnLabel(position.turn);
  let label = result ? `${resultLabel} · ${t(result.reason)}` : turn + (position.check ? ` · ${t('Check')}` : '');
  if (puzzle) {
    if (puzzle.status === 'solved') label = t('Puzzle solved');
    else if (puzzle.status === 'revealed') label = t('Solution shown');
    else if (puzzle.hint) label = t('Hint · Move the piece on {square}', { square: puzzle.hint });
    else label = position.history.length > 0 ? t('Correct · Find the next move') : `${turnLabel(position.turn)} · ${t('Find the best move')}`;
  }
  if (review) {
    if (review.status === 'searching') label = t('Stockfish is analyzing…');
    else if (review.status === 'error') label = t('Analysis could not finish.');
    else if (review.status === 'terminal') label = result ? t(result.reason) : t('No legal moves');
    else label = t('White’s perspective · Depth {depth}', { depth: review.lines[0].depth });
    renderReview(review, elements);
  }
  if (elements.status.textContent !== label) elements.status.textContent = label;
  elements.status.classList.toggle('review-status', Boolean(review));
  elements.status.classList.toggle('ended', Boolean(result) && !review);
  elements.status.classList.toggle('hint-active', Boolean(puzzle?.hint));
  elements.status.classList.toggle('mate', !review && (result?.reason === 'Checkmate' || puzzle?.status === 'solved'));
  elements.top.row.hidden = Boolean(puzzle || review);
  elements.bottom.row.hidden = Boolean(puzzle || review);
  elements.toolbar.hidden = Boolean(puzzle || review);
  elements.reviewHeader.hidden = !review;
  elements.reviewNav.hidden = !review;
  elements.reviewLines.hidden = !review?.lines.length;
  if (!review) {
    elements.reviewSelection.ply = undefined;
    elements.reviewReset.hidden = elements.reviewRetry.hidden = elements.reviewPlayed.hidden = true;
    renderReviewArrow(elements);
  }
  elements.analyze.hidden = !result || Boolean(puzzle || review);
  elements.history.hidden = Boolean(puzzle);
  elements.gameActions.hidden = Boolean(puzzle || review);
  elements.puzzleHeader.hidden = !puzzle;
  elements.puzzleToolbar.hidden = !puzzle;
  elements.solution.hidden = !puzzle || puzzle.status === 'active';
  if (puzzle) {
    elements.puzzleDetails.textContent = t('Rating {rating} · {count} solved', { rating: puzzle.rating, count: puzzle.solved });
    elements.puzzleDetails.title = t('Lichess puzzle {id}', { id: puzzle.id });
    elements.puzzleNext.textContent = t(puzzle.status === 'active' ? 'Skip' : 'Next puzzle');
    elements.hint.hidden = puzzle.status !== 'active';
    elements.hint.disabled = Boolean(puzzle.hint);
    elements.reveal.hidden = puzzle.status !== 'active';
    elements.puzzleRetry.hidden = puzzle.status === 'active';
    elements.solution.textContent = position.history.join(' ');
  }
  elements.toolStatus.hidden = !claimMove && !position.engineError;
  elements.toolStatus.textContent = t(claimMove ? 'Choose a highlighted move to claim the draw. The move will not be played.'
    : 'Stockfish could not complete its move.');
  elements.retry.hidden = !position.engineError;
  elements.undo.disabled = !position.canUndo;
  elements.claim.hidden = !position.claim;
  elements.intended.hidden = position.claimMoves.length === 0;
  elements.intended.textContent = t(claimMove ? 'Cancel draw claim' : 'Claim draw by move');
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
  const openingReview = !state?.review && Boolean(response.state.review);
  const closingReview = Boolean(state?.review) && !response.state.review;
  if (state?.puzzle?.id !== response.state.puzzle?.id || Boolean(state?.review) !== Boolean(response.state.review)) previous = undefined;
  state = response.state;
  if (language !== state.preferences.language) {
    language = state.preferences.language;
    document.documentElement.lang = language;
    home = undefined;
    game = undefined;
    notice.hidden = true;
  }
  document.body.dataset.boardTheme = state.preferences.theme;
  const position = state.position;
  if (!position) {
    previous = undefined;
    return renderHome();
  }
  game ??= createGame();
  if (openingReview) {
    game.historyWasOpen = game.history.open;
    game.history.open = false;
  }
  if (closingReview) game.history.open = game.historyWasOpen;
  if (screen.firstChild !== game.root) screen.replaceChildren(game.root);
  if (previous?.revision !== position.revision) {
    selected = undefined;
    dragged = undefined;
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
