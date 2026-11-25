import { Worker } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import type { Evaluation } from '../shared/analysis';
import { levels, type MoveInput, type Preferences } from '../shared/protocol';

export type EnginePosition = { fen: string; moves: string[]; legal: MoveInput[] };
export type EngineLine = { score: Evaluation; depth: number; moves: string[] };
type EloRange = [number, number];
const coordinate = (move: MoveInput) => move.from + move.to + (move.promotion ?? '');

export class Stockfish {
  constructor(private readonly executable: string) {}

  search(position: EnginePosition, preferences: Preferences, signal: AbortSignal): Promise<MoveInput> {
    const legal = new Map(position.legal.map(move => [coordinate(move), move]));
    const level = levels[preferences.level];
    let alternatives = new Map<number, string>();
    let depth = 0;
    return this.run(position, preferences.thinkMs, signal, range => {
      if ('elo' in level) {
        if (!range) throw new Error('Stockfish did not advertise UCI_Elo');
        const elo = Math.min(range[1], Math.max(range[0], level.elo));
        return ['setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${elo}`];
      }
      const options = ['setoption name UCI_LimitStrength value false', `setoption name Skill Level value ${level.skill}`];
      if (level.variation) options.push('setoption name MultiPV value 4');
      return options;
    }, line => {
      if (!('variation' in level) || !level.variation) return;
      const info = /^info depth (\d+).*?\bmultipv (\d+).*?\bpv ([a-h][1-8][a-h][1-8][qrbn]?)(?: |$)/.exec(line);
      if (info && Number(info[1]) >= depth) {
        if (Number(info[1]) > depth) alternatives = new Map();
        depth = Number(info[1]);
        alternatives.set(Number(info[2]), info[3]);
      }
    }).then(best => {
      const selected = legal.get(best);
      if (!selected) throw new Error('Stockfish returned an illegal move');
      if ('variation' in level && Math.random() < level.variation) {
        const candidates = [...alternatives.values()].filter(move => move !== best && legal.has(move));
        if (candidates.length) return legal.get(candidates[Math.floor(Math.random() * candidates.length)])!;
      }
      return selected;
    });
  }

  async analyze(position: EnginePosition, signal: AbortSignal, playedMove?: string): Promise<EngineLine[]> {
    if (playedMove && !position.legal.some(move => coordinate(move) === playedMove)) {
      throw new Error('The played move is not legal in the analysis position');
    }
    const limit = playedMove ? 1 : Math.min(3, position.legal.length);
    if (limit === 0) return [];
    let depth = 0;
    let lines = new Map<number, EngineLine>();
    let complete: EngineLine[] = [];
    const ranked = () => [...lines].sort(([a], [b]) => a - b).map(([, value]) => value);
    await this.run(position, 1100, signal, () => [
      'setoption name UCI_LimitStrength value false', `setoption name MultiPV value ${limit}`
    ], line => {
      const match = /^info depth (\d+).*?\bmultipv (\d+) score (cp|mate) (-?\d+).*?\bpv (.+)$/.exec(line);
      if (!match || /\b(?:upperbound|lowerbound)\b/.test(line)) return;
      const reportedDepth = Number(match[1]);
      if (reportedDepth < depth) return;
      if (reportedDepth > depth) {
        depth = reportedDepth;
        lines = new Map();
      }
      const kind = match[3] === 'mate' ? 'mate' : 'cp';
      lines.set(Number(match[2]), {
        depth, score: { kind, value: Number(match[4]) }, moves: match[5].trim().split(/\s+/).slice(0, 12)
      });
      if (lines.size === limit) complete = ranked();
    }, playedMove);
    const result = complete.length ? complete : ranked();
    if (playedMove && result[0]?.moves[0] !== playedMove) throw new Error('Stockfish did not analyze the played move');
    if (!result.length) throw new Error('Stockfish returned no analysis lines');
    return result;
  }

  private run(position: EnginePosition, thinkMs: number, signal: AbortSignal,
    configure: (range: EloRange | undefined) => string[], onInfo: (line: string) => void,
    searchMove?: string): Promise<string> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.executable, {
        name: 'VSChessEngine', stdin: true, stdout: true, stderr: true, execArgv: []
      });
      const stdin = worker.stdin!;
      const output = createInterface({ input: worker.stdout, crlfDelay: Infinity });
      let phase: 'uci' | 'ready' | 'search' = 'uci';
      let eloRange: EloRange | undefined;
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
        5000 + thinkMs);
      timeout.unref();
      worker.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-1500); });
      stdin.on('error', fail);
      worker.on('error', fail);
      worker.once('exit', code => fail(new Error(`Stockfish exited (${code}) ${diagnostic.trim()}`)));
      output.on('error', fail);
      signal.addEventListener('abort', abort, { once: true });

      output.on('line', line => {
        const option = /^option name UCI_Elo type spin default \d+ min (\d+) max (\d+)/.exec(line);
        if (option) eloRange = [Number(option[1]), Number(option[2])];
        if (phase === 'uci' && line === 'uciok') {
          phase = 'ready';
          send('setoption name Hash value 4', 'setoption name Ponder value false');
          try { send(...configure(eloRange)); }
          catch (error) { fail(error); return; }
          send('ucinewgame', 'isready');
          return;
        }
        if (phase === 'ready' && line === 'readyok') {
          phase = 'search';
          const moves = position.moves.length ? ' moves ' + position.moves.join(' ') : '';
          const restriction = searchMove ? ` searchmoves ${searchMove}` : '';
          send(`position fen ${position.fen}${moves}`, `go movetime ${thinkMs}${restriction}`);
          return;
        }
        if (phase !== 'search') return;
        if (line.startsWith('info ')) {
          try { onInfo(line); }
          catch (error) { fail(error); }
        } else if (line.startsWith('bestmove ')) {
          if (cleanup()) resolve(line.split(/\s+/)[1]);
        }
      });
      send('uci');
    });
  }
}
