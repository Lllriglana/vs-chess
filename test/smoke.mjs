import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:49381';
const screenshot = process.argv[3];
async function engineThreads() {
  if (process.platform !== 'linux') return [];
  const pids = (await readdir('/proc')).filter(path => /^\d+$/.test(path));
  const matches = await Promise.all(pids.map(async pid => {
    const base = `/proc/${pid}/task`;
    const tasks = await readdir(base).catch(() => []);
    return Promise.all(tasks.map(async tid => {
      const name = await readFile(`${base}/${tid}/comm`, 'utf8').catch(() => '');
      return name.trim() === 'VSChessEngine' ? { pid, tid } : undefined;
    }));
  }));
  return matches.flat().filter(Boolean);
}
async function memory(pid) {
  const status = await readFile(`/proc/${pid}/status`, 'utf8');
  return Number(/^VmRSS:\s+(\d+) kB/m.exec(status)?.[1]);
}
async function sampleEngine() {
  if (process.platform !== 'linux' || process.env.VSCHESS_PROFILE !== '1') return;
  let worker;
  for (let attempt = 0; attempt < 20 && !worker; attempt++) {
    [worker] = await engineThreads();
    if (!worker) await sleep(25);
  }
  assert.ok(worker, 'Expected a Stockfish worker during search');
  const scale = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  async function ticks() {
    const stat = await readFile(`/proc/${worker.pid}/task/${worker.tid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
    return Number(fields[11]) + Number(fields[12]);
  }
  await sleep(200);
  const before = await ticks();
  const start = performance.now();
  await sleep(650);
  const after = await ticks();
  const elapsed = (performance.now() - start) / 1000;
  const rss = await memory(worker.pid);
  console.log(`Stockfish worker sample: ${(100 * (after - before) / scale / elapsed).toFixed(0)}% of one logical CPU over ${elapsed.toFixed(2)} s; extension host RSS ${rss} KiB`);
  return { ...worker, rss };
}

const browser = await chromium.connectOverCDP(endpoint);
try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 15_000 });
  page.setDefaultTimeout(12_000);
  const webErrors = [];
  const externalRequests = [];
  page.on('pageerror', error => {
    if (/webview|webview\.js/.test(error.stack ?? '')) webErrors.push(error.message);
  });
  page.on('console', message => {
    if (message.type() === 'error' && /webview\.js|Content Security Policy/.test(
      message.location().url + message.text())) webErrors.push(message.text());
  });
  await context.route(/^https?:\/\//, route => {
    if (route.request().url().includes('.vscode-resource.vscode-cdn.net/')) return route.continue();
    try {
      if (route.request().frame().url().includes('vscode-webview')) externalRequests.push(route.request().url());
    } catch { /* Requests from a service worker have no frame. */ }
    return route.abort('internetdisconnected');
  });

  const activity = page.getByRole('tab', { name: 'VS Chess', exact: true });
  await activity.waitFor();
  if (await activity.getAttribute('aria-selected') !== 'true') await activity.click();
  await page.waitForFunction(() => !!document.querySelector('iframe.webview'));
  const webview = page.frameLocator('iframe.webview').frameLocator('#active-frame');
  const byButton = name => webview.getByRole('button', { name, exact: true });
  const status = webview.locator('.game-status');
  const square = name => webview.locator(`[data-square="${name}"]`);
  async function text(locator, pattern) {
    await locator.and(webview.getByText(pattern)).first().waitFor();
  }
  async function move(from, to) {
    await square(from).click();
    await square(to).click();
  }
  async function setup(mode, color, timed) {
    if (await byButton('New Game').count()) await byButton('New Game').click();
    await byButton(mode).click();
    if (color) await webview.getByLabel('Play as').selectOption({ label: color });
    if (mode === 'Two players') {
      await webview.getByLabel('Time control').selectOption({ label: timed ? '3 + 2' : 'Untimed' });
    }
    await byButton('Start game').click();
  }
  async function settings(theme, pieces, thinking) {
    await byButton('Settings').click();
    await webview.getByLabel('Board', { exact: true }).selectOption({ label: theme });
    await webview.getByLabel('Pieces').selectOption({ label: pieces });
    await webview.getByLabel('Thinking time').selectOption({ label: thinking });
    await byButton('Save settings').click();
  }

  await setup('Two players', null, true);
  await status.waitFor();
  const csp = await webview.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.match(csp, /^default-src 'none'; script-src 'nonce-/);
  assert.equal(await webview.locator('.square').count(), 64);
  await text(status, 'White to move');
  assert.equal(await square('f2').evaluate(node => node.draggable), false);
  const grip = square('f2').locator('.piece-grip[draggable="true"]');
  await grip.dragTo(square('f3'));
  await text(status, 'Black to move');
  assert.match(await square('f3').getAttribute('aria-label'), /White pawn/);
  await move('e7', 'e5');
  await move('g2', 'g4');
  await move('d8', 'h4');
  await text(status, 'Black wins · Checkmate');
  await webview.locator('.game-status.mate').waitFor();
  await webview.locator('.player.mating-player').waitFor();
  assert.match(await square('e1').getAttribute('aria-label'), /in check/);
  await byButton('Undo').click();
  await text(status, 'Black to move');
  await byButton('Flip').click();
  await webview.locator('.square:first-child[data-square="h1"]').waitFor();
  assert.deepEqual(await engineThreads(), []);
  await settings('Minimal', 'Letters', '3 s');
  await webview.locator('body[data-board-theme="minimal"] .piece-letter').first().waitFor();
  await page.getByRole('tab', { name: /^Explorer/ }).click();
  await activity.click();
  await text(status, 'Black to move');
  assert.match(await square('g4').getAttribute('aria-label'), /White pawn/);
  console.log('Two-player clocks, drag, mate, undo, flip, two piece styles, and view reopen passed');

  await byButton('Puzzles').click();
  await webview.getByText(/to move · Find the best move/).waitFor();
  await byButton('Hint').click();
  const marked = webview.locator('.square.puzzle-hint');
  await marked.waitFor();
  const hintedSquare = await marked.getAttribute('data-square');
  await text(status, `Hint · Move the piece on ${hintedSquare}`);
  await byButton('Settings').click();
  await webview.getByLabel('Language', { exact: true }).selectOption({ label: 'Русский' });
  await byButton('Save settings').click();
  await text(status, `Подсказка · Походите фигурой с ${hintedSquare}`);
  assert.equal(await webview.locator('html').getAttribute('lang'), 'ru');
  await byButton('Настройки').click();
  await webview.getByLabel('Язык', { exact: true }).selectOption({ label: 'English' });
  await byButton('Сохранить').click();
  await text(status, `Hint · Move the piece on ${hintedSquare}`);
  await byButton('Show solution').click();
  await text(status, 'Solution shown');
  await webview.locator('.puzzle-solution').waitFor();
  await byButton('Try again').click();
  await webview.getByText(/to move · Find the best move/).waitFor();
  await byButton('Back to games').click();
  await text(status, 'Black to move');
  assert.match(await square('g4').getAttribute('aria-label'), /White pawn/);
  console.log('Offline puzzle, hint, solution, retry, and returning to the ongoing game passed');

  await setup('Two players', null, false);
  await text(status, 'White to move');
  await square('a2').focus();
  await square('a2').press('Enter');
  await square('a2').press('ArrowUp');
  await square('a3').press('ArrowUp');
  await square('a4').press('Enter');
  await text(status, 'Black to move');
  const promotionPath = [
    ['h7', 'h5'], ['a4', 'a5'], ['h5', 'h4'], ['a5', 'a6'],
    ['h4', 'h3'], ['a6', 'b7'], ['h3', 'g2']
  ];
  for (const [index, [from, to]] of promotionPath.entries()) {
    await move(from, to);
    await text(status, index % 2 ? 'Black to move' : 'White to move');
  }
  await move('b7', 'a8');
  await byButton('Knight').click();
  await webview.locator('[data-square="a8"][aria-label*="White knight"]').waitFor();
  console.log('Keyboard moves and the promotion picker passed');

  await settings('Classic', 'Figurines', '3 s');
  await setup('Play Stockfish', 'Random', false);
  await webview.getByText('You', { exact: true }).waitFor();
  await byButton('New Game').click();
  await byButton('Play Stockfish').click();
  const color = webview.getByLabel('Play as');
  assert.equal(await color.locator('option:checked').textContent(), 'Random');
  await color.selectOption({ label: 'White' });
  await byButton('Start game').click();
  await text(status, 'White to move');
  await move('e2', 'e4');
  await text(status, 'Stockfish is thinking…');
  const running = await sampleEngine();
  await page.getByRole('tab', { name: /^Explorer/ }).click();
  if (process.platform === 'linux') {
    for (let attempt = 0; attempt < 30 && (await engineThreads()).length; attempt++) await sleep(25);
    assert.deepEqual(await engineThreads(), []);
  }
  if (running) {
    const idleRss = await memory(running.pid);
    console.log(`After hiding the view: extension host RSS ${idleRss} KiB, active-minus-idle RSS ${running.rss - idleRss} KiB`);
  }
  console.log('No Stockfish worker while the view is hidden');
  await activity.click();
  await text(status, 'White to move');
  await move('g1', 'f3');
  await text(status, 'Stockfish is thinking…');
  await text(status, 'White to move');
  await byButton('Undo').click();
  await text(status, 'White to move');
  await webview.locator('[data-square="g1"][aria-label*="White knight"]').waitFor();
  await settings('Dark', 'Figurines', '0.3 s');
  await setup('Play Stockfish', 'Black', false);
  await text(status, 'Black to move');
  await move('e7', 'e5');
  await text(status, 'Stockfish is thinking…');
  await text(status, 'Black to move');
  await byButton('Settings').click();
  await webview.getByLabel('Language', { exact: true }).selectOption({ label: 'Русский' });
  await byButton('Save settings').click();
  await byButton('Настройки').waitFor();

  const innerFrame = page.frameLocator('iframe.webview').locator('#active-frame');
  const originalWidth = await innerFrame.evaluate(node => node.getAttribute('style'));
  for (const width of [240, 320, 500]) {
    await innerFrame.evaluate((node, size) => { node.style.width = `${size}px`; }, width);
    const dimensions = await webview.locator('.board').evaluate(board => {
      const bounds = board.getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.toolbar button')];
      const splitWords = buttons.flatMap(button => {
        const label = button.firstChild;
        if (!(label instanceof Text)) throw new Error('Expected a toolbar label');
        return [...label.data.matchAll(/\S+/gu)].filter(word => {
          const range = document.createRange();
          range.setStart(label, word.index);
          range.setEnd(label, word.index + word[0].length);
          return range.getClientRects().length !== 1;
        }).map(word => word[0]);
      });
      return { viewport: window.innerWidth, width: bounds.width, height: bounds.height,
        scrollWidth: document.documentElement.scrollWidth, splitWords,
        toolbarRows: new Set(buttons.map(button => button.getBoundingClientRect().top)).size };
    });
    assert.equal(dimensions.viewport, width);
    assert.ok(Math.abs(dimensions.width - dimensions.height) < 1);
    assert.ok(dimensions.scrollWidth <= width);
    assert.deepEqual(dimensions.splitWords, []);
    assert.equal(dimensions.toolbarRows, width < 400 ? 2 : 1);
  }
  await innerFrame.evaluate((node, style) => {
    if (style === null) node.removeAttribute('style');
    else node.setAttribute('style', style);
  }, originalWidth);
  await byButton('Настройки').click();
  await webview.getByLabel('Язык', { exact: true }).selectOption({ label: 'English' });
  await byButton('Сохранить').click();
  await text(status, 'Black to move');
  await webview.locator('.history summary').click();
  await webview.locator('.move-pair').first().waitFor();
  if (process.env.VSCHESS_LIGHT === '1') {
    await webview.locator('body.vscode-light').waitFor();
  }
  console.log('Sidebar board and Russian controls fit 240 px, 320 px, and 500 px webview widths');
  if (screenshot) {
    const sidebar = await page.locator('.part.sidebar').boundingBox();
    const options = await webview.locator('.game .more').boundingBox();
    const height = Math.min(sidebar.height, options.y + options.height + 18 - sidebar.y);
    await page.screenshot({ path: screenshot, clip: { ...sidebar, height } });
  }
  console.log('Stockfish modes as White and Black, search recovery, undo, and changes to thinking time passed');
  await webview.getByText('Draw & resign', { exact: true }).click();
  await byButton('Resign').click();
  await webview.getByRole('dialog').getByRole('button', { name: 'Resign', exact: true }).click();
  await text(status, 'Stockfish wins · Resignation');
  assert.deepEqual(await engineThreads(), []);
  console.log('No Stockfish worker after resignation');

  await byButton('Analyze game').click();
  await webview.locator('.review-score').first().waitFor();
  await webview.locator('.review-arrow.visible').waitFor();
  await webview.locator('.review-line').first().click();
  await webview.locator('.review-steps button').first().click();
  await byButton('Return to position').waitFor();
  await byButton('Return to position').click();
  await byButton('Start position').click();
  await webview.getByText(/^Position 0 \/ /).waitFor();
  await byButton('Back to game').click();
  await text(status, 'Stockfish wins · Resignation');
  console.log('Game analysis and variation preview left the result intact');

  await page.keyboard.press('F1');
  const palette = page.locator('.quick-input-widget input');
  await palette.fill('>Developer: Reload Window');
  await page.getByText('Developer: Reload Window', { exact: true }).first().waitFor();
  await Promise.all([page.waitForEvent('domcontentloaded'), palette.press('Enter')]);
  await activity.waitFor();
  // A restored workbench can briefly report the previous sidebar before laying out the selected view.
  const iframe = page.locator('iframe.webview');
  const appeared = await iframe.waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (!appeared && await activity.getAttribute('aria-selected') !== 'true') await activity.click();
  try {
    await text(status, 'Stockfish wins · Resignation');
  } catch (error) {
    console.log('Reload diagnostics', {
      selected: await activity.getAttribute('aria-selected').catch(() => null),
      visibleFrames: page.frames().length,
      gameStatus: await status.textContent({ timeout: 1000 }).catch(() => null),
      webErrors
    });
    throw error;
  }
  assert.match(await webview.locator('body').getAttribute('data-board-theme'), /dark/);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(webErrors, []);
  console.log('Reload restored game and preferences. No webview errors or external requests detected.');
} finally {
  await browser.close();
}
