import { writeFile, readFile, rename, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'current-match.json');
const FONT_DIR = join(__dirname, '..', 'public', 'fonts');

const FONT_EXT = ['.woff2', '.woff', '.otf', '.ttf'];

// 調整データを持つ単位。config.html の「表示の管理」タブはここから作られる。
// 増やすときはここに1行足す
export const DISPLAYS = [
  { id: 'full', file: 'disp-full.html', label: 'フルスクリーン', counterStyleOption: false }
];

// 実際に開けるページの一覧。index.html の入口はここから作られる。
// styleOf で、どの DISPLAYS の調整データを使うかを指す。
// 見た目の項目(位置・サイズ・フォント)を共有したいページは
// 同じ styleOf を指定すれば、個別の調整タブを持たずに済む
export const OUTPUTS = [
  { file: 'disp-full.html',      label: 'フルスクリーン',           styleOf: 'full' },
  { file: 'disp-full-flip.html', label: 'フルスクリーン(左右反転)', styleOf: 'full' }
];

const RULES = {
  format: 5,
  pointsToWin: 25,
  finalSetPoints: 15,
  timeoutsPerSet: 2,
  subsPerSet: 6,
  challengesPerSet: 2,
  counterDisplay: {
    timeouts:   { visible: true, mode: 'remaining' },
    subs:       { visible: true, mode: 'remaining' },
    challenges: { visible: true, mode: 'remaining' }
  }
};

export function createDisplay() {
  return {
    font: 'system',
    blocks: {
      name:    { x: 0, y: 0, size: 76 },
      score:   { x: 0, y: 0, size: 410 },
      result:  { x: 0, y: 0, size: 124 },
      counter: { x: 0, y: 0, size: 124, style: 'number' }
    }
  };
}

function createTeam(name) {
  return { name, score: 0, setsWon: 0, timeouts: 0, subs: 0, challenges: 0 };
}

export function createInitialState() {
  const displays = {};
  for (const d of DISPLAYS) displays[d.id] = createDisplay();

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
    const files = await readdir(FONT_DIR);
    return files
      .filter((f) => FONT_EXT.includes(extname(f).toLowerCase()))
      .map((f) => ({ file: f, name: basename(f, extname(f)) }))
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
  // displayDefs / outputs は常にコード側の最新定義を使う。
  // 保存データに古い fullFlip 用の設定が残っていても、
  // fillMissing の時点で base(=最新のDISPLAYS)に無いキーとして自動的に落ちる
  state.displayDefs = DISPLAYS;
  state.outputs = OUTPUTS;
  for (const d of DISPLAYS) {
    if (!state.displays[d.id]) state.displays[d.id] = createDisplay();
  }
  return state;
}
