import { Worker } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import { isMove, levels, type MoveInput, type Preferences } from '../shared/protocol';

export type EnginePosition = { fen: string; moves: string[]; legal: MoveInput[] };
const coordinate = (move: MoveInput) => move.from + move.to + (move.promotion ?? '');

export class Stockfish {
  constructor(private readonly executable: string) {}

  search(position: EnginePosition, preferences: Preferences, signal: AbortSignal): Promise<MoveInput> {
    signal.throwIfAborted();
    const legal = new Map(position.legal.map(move => [coordinate(move), move]));
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.executable, {
        name: 'VSChessEngine', stdin: true, stdout: true, stderr: true, execArgv: []
      });
      const stdin = worker.stdin!;
      const output = createInterface({ input: worker.stdout, crlfDelay: Infinity });
      let phase: 'uci' | 'ready' | 'search' = 'uci';
      let eloRange: [number, number] | undefined;
      const level = levels[preferences.level];
      let alternatives = new Map<number, string>();
      let depth = 0;
      let completed = false;
      let diagnostic = '';

      function cleanup() {
        if (completed) return false;
        completed = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        output.close();
        stdin.destroy();
        void worker.terminate();
        return true;
      }
      function fail(error: unknown) {
        if (cleanup()) reject(error);
      }
      function abort() { fail(signal.reason); }
      function send(...commands: string[]) { stdin.write(commands.join('\n') + '\n'); }
      const timeout = setTimeout(() => fail(new Error('Stockfish did not finish within the UCI deadline')),
        5000 + preferences.thinkMs);
      timeout.unref();
      worker.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-1500); });
      stdin.on('error', fail);
      worker.on('error', fail);
      worker.once('close', (code, reason) => fail(new Error(`Stockfish exited (${code ?? reason}) ${diagnostic.trim()}`)));
      output.on('error', fail);
      signal.addEventListener('abort', abort, { once: true });

      output.on('line', line => {
        const option = /^option name UCI_Elo type spin default \d+ min (\d+) max (\d+)/.exec(line);
        if (option) eloRange = [Number(option[1]), Number(option[2])];
        if (phase === 'uci' && line === 'uciok') {
          phase = 'ready';
          send('setoption name Hash value 4', 'setoption name Ponder value false');
          if ('elo' in level) {
            if (!eloRange) return fail(new Error('Stockfish did not advertise UCI_Elo'));
            const elo = Math.min(eloRange[1], Math.max(eloRange[0], level.elo));
            send('setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${elo}`);
          } else {
            send('setoption name UCI_LimitStrength value false', `setoption name Skill Level value ${level.skill}`);
            if (level.variation) send('setoption name MultiPV value 4');
          }
          send('ucinewgame', 'isready');
          return;
        }
        if (phase === 'ready' && line === 'readyok') {
          phase = 'search';
          const moves = position.moves.length ? ' moves ' + position.moves.join(' ') : '';
          send(`position fen ${position.fen}${moves}`, `go movetime ${preferences.thinkMs}`);
          return;
        }
        if (phase !== 'search') return;
        if ('variation' in level && level.variation && line.startsWith('info depth ')) {
          const info = /^info depth (\d+).*?\bmultipv (\d+).*?\bpv ([a-h][1-8][a-h][1-8][qrbn]?)(?: |$)/.exec(line);
          if (info && Number(info[1]) >= depth) {
            if (Number(info[1]) > depth) alternatives = new Map();
            depth = Number(info[1]);
            alternatives.set(Number(info[2]), info[3]);
          }
        }
        if (line.startsWith('bestmove ')) {
          const best = line.split(/\s+/)[1];
          let selected = legal.get(best);
          if (!selected || !isMove(selected)) return fail(new Error('Stockfish returned an illegal move'));
          if ('variation' in level && Math.random() < level.variation) {
            const candidates = [...alternatives.values()].filter(move => move !== best && legal.has(move));
            if (candidates.length) selected = legal.get(candidates[Math.floor(Math.random() * candidates.length)])!;
          }
          if (cleanup()) resolve(selected);
        }
      });
      send('uci');
    });
  }
}
