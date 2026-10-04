import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import {
  load, scheduleSave, createInitialState, resetForNextSet, targetScore, listFonts
} from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

let state = await load();

app.use(express.static(join(__dirname, '..', 'public'), {
  // 開発中・会場運用ともに、ブラウザに古いファイルを使われると
  // 原因の分かりにくい不具合になるため、キャッシュを無効にする
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  }
}));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/fonts', async (req, res) => res.json(await listFonts()));

// LAN内の他の端末(OBS・スマホなど)からアクセスできるIPアドレスを探す。
// Wi-Fi・有線・仮想ネットワークが混在するため、プライベートIPの範囲に絞り込む
function findLanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address;
      const isPrivate =
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
      if (isPrivate) list.push({ name, ip });
    }
  }
  return list;
}

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
const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const opponentOf = (team) => (team === 'home' ? 'away' : 'home');

io.on('connection', (socket) => {
  console.log(`接続: ${socket.id}`);
  socket.emit('state', state);

  socket.on('score:add', ({ team, delta }) => {
    if (!TEAMS.includes(team)) return;

    if (delta > 0) {
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
      shortNames: { home: state.home.shortName, away: state.away.shortName },
      rules: state.rules,
      displays: state.displays
    };
    state = createInitialState();
    state.home.name = keep.names.home;
    state.away.name = keep.names.away;
    state.home.shortName = keep.shortNames.home;
    state.away.shortName = keep.shortNames.away;
    state.rules = keep.rules;
    state.displays = keep.displays;
    broadcast();
  });

  socket.on('team:rename', ({ team, name }) => {
    if (!TEAMS.includes(team) || typeof name !== 'string') return;
    state[team].name = name.slice(0, 60);
    broadcast();
  });

  socket.on('team:shortname', ({ team, shortName }) => {
    if (!TEAMS.includes(team) || typeof shortName !== 'string') return;
    state[team].shortName = shortName.slice(0, 10);
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

    if (patch.blocks && typeof patch.blocks === 'object') {
      for (const [key, val] of Object.entries(patch.blocks)) {
        const b = d.blocks[key];
        if (!b || !val || typeof val !== 'object') continue;
        if (isNum(val.size))      b.size      = clamp(val.size, 8, 900);
        if (isNum(val.x))         b.x         = clamp(val.x, -960, 960);
        if (isNum(val.y))         b.y         = clamp(val.y, -540, 540);
        if (isNum(val.width))     b.width     = clamp(val.width, 10, 900);
        if (isNum(val.thickness)) b.thickness = clamp(val.thickness, 1, 200);
        if (isNum(val.gap))       b.gap       = clamp(val.gap, -400, 400);
        if (isNum(val.rowGap))    b.rowGap    = clamp(val.rowGap, -120, 400);
        if (typeof val.font === 'string') b.font = val.font.slice(0, 80);
        if (typeof val.label === 'string') b.label = val.label.slice(0, 20);
        if (typeof val.label === 'string') b.label = val.label.slice(0, 20);
        if (isHexColor(val.color)) b.color = val.color;
        if (isHexColor(val.setsColor)) b.setsColor = val.setsColor;
        if (isHexColor(val.maxColor)) b.maxColor = val.maxColor;
        if (typeof val.animate === 'boolean') b.animate = val.animate;
        if (typeof val.showDash === 'boolean') b.showDash = val.showDash;
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
  const lan = findLanAddresses();
  console.log('');
  console.log('========================================');
  console.log(' VSB サーバーを起動しました');
  console.log('========================================');
  console.log(`  このPCから : http://localhost:${PORT}`);
  if (lan.length === 0) {
    console.log('  LAN内から  : (ネットワークに接続されていないようです)');
  } else {
    for (const { name, ip } of lan) {
      console.log(`  LAN内から  : http://${ip}:${PORT}   (${name})`);
    }
  }
  console.log('----------------------------------------');
  console.log(`  目標点: ${targetScore(state)}点`);
  console.log('');
});
