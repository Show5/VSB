import { writeFile, readFile, rename, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'current-match.json');
const FONT_DIR = join(__dirname, '..', 'public', 'fonts');

const FONT_EXT = ['.woff2', '.woff', '.otf', '.ttf'];

export const DISPLAYS = [
  { id: 'full',   file: 'disp-full.html',   label: 'フルスクリーン', counterStyleOption: false },
  { id: 'result', file: 'disp-result.html', label: '試合結果',       counterStyleOption: false }
];

export const OUTPUTS = [
  { file: 'disp-full.html',      label: 'フルスクリーン',           styleOf: 'full' },
  { file: 'disp-full-flip.html', label: 'フルスクリーン(左右反転)', styleOf: 'full' },
  { file: 'disp-result.html',    label: '試合結果',                 styleOf: 'result' }
];

const RULES = {
  format: 5,
  pointsToWin: 25,
  finalSetPoints: 15,
  timeoutsPerSet: 2,
  subsPerSet: 6,
  challengesPerSet: 2,
  counterDisplay: {
    timeouts:   { visible: true, mode: 'used' },
    subs:       { visible: true, mode: 'used' },
    challenges: { visible: true, mode: 'remaining' }
  }
};

// serve は文字ではなく色付きの丸なので font を持たない。
// size は丸の直径、color は塗りつぶし色(既定は赤)
const BLOCK_PRESETS = {
  full: {
    name:    { x: 0, y: 0, size: 76,  font: 'system', color: '#000000' },
    score:   { x: 0, y: 0, size: 410, font: 'system', color: '#000000', animate: true },
    result:  { x: 0, y: 0, size: 124, font: 'system', color: '#000000' },
    serve:   { x: 0, y: 0, size: 150, color: '#ff0000' },
    counter: { x: 0, y: 0, size: 124, font: 'system', color: '#000000', style: 'number' }
  },
  result: {
    name:    { x: 0, y: 0, size: 76,  font: 'system', color: '#000000' },
    setsWon: { x: 0, y: 0, size: 500, font: 'system', color: '#000000' },
    table:   { x: 0, y: 0, size: 124, font: 'system', color: '#000000' }
  }
};

export function createDisplay(id) {
  const preset = BLOCK_PRESETS[id] || BLOCK_PRESETS.full;
  return { blocks: JSON.parse(JSON.stringify(preset)) };
}

function createTeam(name) {
  return { name, shortName: '', score: 0, setsWon: 0, timeouts: 0, subs: 0, challenges: 0 };
}

export function createInitialState() {
  const displays = {};
  for (const d of DISPLAYS) displays[d.id] = createDisplay(d.id);

  return {
    currentSet: 1,
    servingTeam: 'home',
    home: createTeam('HOME'),
    away: createTeam('AWAY'),
    setResults: [],
    finished: false,
    rules: JSON.parse(JSON.stringify(RULES)),
    displays,
    displayDefs: DISPLAYS,
    outputs: OUTPUTS
  };
}

export function resetForNextSet(state) {
  for (const t of ['home', 'away']) {
    state[t].score = 0;
    state[t].timeouts = 0;
    state[t].subs = 0;
    state[t].challenges = 0;
  }
}

export function targetScore(state) {
  const { format, pointsToWin, finalSetPoints } = state.rules;
  return state.currentSet === format ? finalSetPoints : pointsToWin;
}

export async function listFonts() {
  try {
    const entries = await readdir(FONT_DIR, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && FONT_EXT.includes(extname(e.name).toLowerCase()))
      .map((e) => {
        const parentDir = e.parentPath ?? e.path;
        const relDir = relative(FONT_DIR, parentDir);
        const relPath = relDir ? join(relDir, e.name) : e.name;
        const urlPath = relPath.split(sep).join('/');
        const withoutExt = urlPath.slice(0, -extname(urlPath).length);
        return { file: urlPath, name: withoutExt.split('/').join(' / ') };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

let saveTimer = null;

export function scheduleSave(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(state), 300);
}

async function save(state) {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, FILE);
  } catch (err) {
    console.error('保存に失敗:', err.message);
  }
}

function fillMissing(base, saved) {
  if (saved === undefined || saved === null) return base;
  if (Array.isArray(base) || typeof base !== 'object') return saved;
  if (typeof saved !== 'object' || Array.isArray(saved)) return base;

  const out = {};
  for (const key of Object.keys(base)) out[key] = fillMissing(base[key], saved[key]);
  return out;
}

export async function load() {
  const base = createInitialState();
  let state = base;
  try {
    state = fillMissing(base, JSON.parse(await readFile(FILE, 'utf8')));
    console.log('前回の試合状態を復元しました');
  } catch {
    console.log('新規の試合状態で開始します');
  }
  state.displayDefs = DISPLAYS;
  state.outputs = OUTPUTS;
  for (const d of DISPLAYS) {
    if (!state.displays[d.id]) state.displays[d.id] = createDisplay(d.id);
  }
  return state;
}
