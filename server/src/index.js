import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  load, scheduleSave, createInitialState, resetForNextSet, targetScore, listFonts
} from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

let state = await load();

app.use(express.static(join(__dirname, '..', 'public')));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/fonts', async (req, res) => res.json(await listFonts()));

function broadcast() {
  io.emit('state', state);
  scheduleSave(state);
}

const TEAMS = ['home', 'away'];
const KINDS = ['timeouts', 'subs', 'challenges'];
const LIMIT_KEY = {
  timeouts: 'timeoutsPerSet',
  subs: 'subsPerSet',
  challenges: 'challengesPerSet'
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const opponentOf = (team) => (team === 'home' ? 'away' : 'home');

io.on('connection', (socket) => {
  console.log(`接続: ${socket.id}`);
  socket.emit('state', state);

  socket.on('score:add', ({ team, delta }) => {
    if (!TEAMS.includes(team)) return;

    if (delta > 0) {
      // 自チームがすでに目標点に達している場合、相手の得点が
      // 「自チームの得点-1」以上(=まだデュース状態)でなければ加点を拒否する。
      // 2点差以上ですでに決着している状態から、得点を積み増せてしまうのを防ぐ
      const target = targetScore(state);
      const myScore = state[team].score;
      const oppScore = state[opponentOf(team)].score;
      if (myScore >= target && oppScore < myScore - 1) return;
    }

    state[team].score = Math.max(0, state[team].score + delta);
    if (delta > 0) state.servingTeam = team;
    broadcast();
  });

  socket.on('serve:set', ({ team }) => {
    if (!TEAMS.includes(team)) return;
    state.servingTeam = team;
    broadcast();
  });

  socket.on('counter:use', ({ team, kind }) => {
    if (!TEAMS.includes(team) || !KINDS.includes(kind)) return;
    const max = state.rules[LIMIT_KEY[kind]];
    state[team][kind] = Math.min(max, state[team][kind] + 1);
    broadcast();
  });

  socket.on('counter:undo', ({ team, kind }) => {
    if (!TEAMS.includes(team) || !KINDS.includes(kind)) return;
    state[team][kind] = Math.max(0, state[team][kind] - 1);
    broadcast();
  });

  socket.on('set:end', () => {
    if (state.finished) return;
    const { home, away, currentSet } = state;
    const winner = home.score > away.score ? 'home' : 'away';

    state.setResults.push({ set: currentSet, home: home.score, away: away.score });
    state[winner].setsWon += 1;

    if (state.setResults.length >= state.rules.format) {
      state.finished = true;
    } else {
      state.currentSet += 1;
      resetForNextSet(state);
    }
    broadcast();
  });

  socket.on('match:reset', () => {
    const keep = {
      names: { home: state.home.name, away: state.away.name },
      rules: state.rules,
      displays: state.displays
    };
    state = createInitialState();
    state.home.name = keep.names.home;
    state.away.name = keep.names.away;
    state.rules = keep.rules;
    state.displays = keep.displays;
    broadcast();
  });

  socket.on('team:rename', ({ team, name }) => {
    if (!TEAMS.includes(team) || typeof name !== 'string') return;
    state[team].name = name.slice(0, 60);
    broadcast();
  });

  socket.on('rules:set', (patch) => {
    if (!patch || typeof patch !== 'object') return;
    const r = state.rules;

    if (isNum(patch.format))           r.format           = clamp(patch.format, 1, 9);
    if (isNum(patch.pointsToWin))      r.pointsToWin      = clamp(patch.pointsToWin, 1, 99);
    if (isNum(patch.finalSetPoints))   r.finalSetPoints   = clamp(patch.finalSetPoints, 1, 99);
    if (isNum(patch.timeoutsPerSet))   r.timeoutsPerSet   = clamp(patch.timeoutsPerSet, 0, 9);
    if (isNum(patch.subsPerSet))       r.subsPerSet       = clamp(patch.subsPerSet, 0, 20);
    if (isNum(patch.challengesPerSet)) r.challengesPerSet = clamp(patch.challengesPerSet, 0, 9);

    if (patch.counterDisplay && typeof patch.counterDisplay === 'object') {
      for (const kind of KINDS) {
        const cd = patch.counterDisplay[kind];
        if (!cd || typeof cd !== 'object') continue;
        const target = r.counterDisplay[kind];
        if (typeof cd.visible === 'boolean') target.visible = cd.visible;
        if (cd.mode === 'used' || cd.mode === 'remaining') target.mode = cd.mode;
      }
    }

    for (const team of TEAMS) {
      for (const kind of KINDS) {
        state[team][kind] = Math.min(state[team][kind], r[LIMIT_KEY[kind]]);
      }
    }
    broadcast();
  });

  socket.on('display:set', ({ id, patch }) => {
    const d = state.displays[id];
    if (!d || !patch || typeof patch !== 'object') return;

    if (typeof patch.font === 'string') d.font = patch.font.slice(0, 80);

    if (patch.blocks && typeof patch.blocks === 'object') {
      for (const [key, val] of Object.entries(patch.blocks)) {
        const b = d.blocks[key];
        if (!b || !val || typeof val !== 'object') continue;
        if (isNum(val.size)) b.size = clamp(val.size, 8, 900);
        if (isNum(val.x))    b.x    = clamp(val.x, -960, 960);
        if (isNum(val.y))    b.y    = clamp(val.y, -540, 540);
        if (typeof val.style === 'string' && ['number', 'lamp'].includes(val.style)) {
          b.style = val.style;
        }
      }
    }
    broadcast();
  });

  socket.on('disconnect', () => console.log(`切断: ${socket.id}`));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`起動: http://localhost:${PORT}  /  http://192.168.3.163:${PORT}`);
  console.log(`目標点: ${targetScore(state)}点`);
});
