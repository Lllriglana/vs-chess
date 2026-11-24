import type { Color, PieceSymbol } from 'chess.js';

export const names: Record<PieceSymbol, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
};

const silhouettes: Record<PieceSymbol, string> = {
  p: 'M20 8a4.3 4.3 0 0 0-2 8.1c-1 3.8-2.5 6.7-5.2 8.9l-2.6 4.5h19.6L27.2 25c-2.7-2.2-4.2-5.1-5.2-8.9A4.3 4.3 0 0 0 20 8Z',
  n: 'M10 29.5c1.3-5.3 5-7.6 8.6-10.7l-1.3-1.1-5.4 3.8-4-2.7 3.3-5.4 5-4.5L17 5l4.5 2.6c6.7.4 11.2 5.7 11.2 13.2v8.7Z',
  b: 'M20 7c-3 2.8-7 5.4-7 10.3a7 7 0 0 0 3.3 6L13 26l-2 3.5h18L27 26l-3.3-2.7a7 7 0 0 0 3.3-6c0-4.9-4-7.5-7-10.3Z',
  r: 'M10 8h5.5v4h2.2V8h4.6v4h2.2V8H30v8l-4.5 3.5v7l3.8 3H10.7l3.8-3v-7L10 16Z',
  q: 'm9 13 5.8 6.2L20 9l5.2 10.2L31 13l-3.8 13.4 2.2 3.1H10.6l2.2-3.1Z',
  k: 'M13.6 26.6c-1-3.6-6.2-5.2-6.2-9.8 0-4.8 7.1-5.8 10.2-1.8l2.4-4 2.4 4c3.1-4 10.2-3 10.2 1.8 0 4.6-5.2 6.2-6.2 9.8l2 2.9H11.6Z'
};
const details: Partial<Record<PieceSymbol, string>> = {
  n: 'M17.5 12.8h.1 M22 10c4.5 1.7 7 5.2 7 11.5 M13 26.5h18',
  b: 'm23.5 11.4-5.8 7 M15.5 23.5h9',
  r: 'M14.5 19.5h11 M14.5 26.5h11',
  q: 'M13 26h14',
  k: 'M20 4.5v7 M16.5 7.5h7 M13.5 26.5h13 M20 15v8',
  p: 'M14.5 24h11'
};

const svgNS = 'http://www.w3.org/2000/svg';
function shape(tag: 'path' | 'circle' | 'rect', attributes: Record<string, string>) {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
export function figurine(type: PieceSymbol, color: Color) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('piece', color);
  svg.append(shape('path', { class: 'piece-body', d: silhouettes[type] }));
  if (type === 'b') svg.append(shape('circle', { class: 'piece-body', cx: '20', cy: '6.6', r: '2' }));
  if (type === 'q') {
    for (const [cx, cy] of [['8.5', '12'], ['20', '8.4'], ['31.5', '12']]) {
      svg.append(shape('circle', { class: 'piece-body', cx, cy, r: '2.15' }));
    }
  }
  const detail = details[type];
  if (detail) svg.append(shape('path', { class: 'piece-detail', d: detail }));
  svg.append(shape('rect', { class: 'piece-body', x: '8.6', y: '29', width: '22.8', height: '4.8', rx: '1.8' }));
  return svg;
}
