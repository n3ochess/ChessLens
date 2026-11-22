/* ChessLens — local chess analysis (chess.js + Stockfish.js in a Web Worker) */
(function () {
'use strict';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DEPTH = 11;
const MOVETIME_MS = 220;

/* localStorage keys (v7) + legacy keys migrated/cleaned on boot */
const LS_PROFILES = 'chesslens.profiles.v7';
const LS_PREFS = 'chesslens.prefs.v7';
const LS_PGN = 'chesslens.lastpgn.v7';
const LS_CACHE = 'chesslens.cache.v7';
const LEGACY_PROFILES = 'chesslens.profiles.v6';
const LEGACY_PREFS = 'chesslens.prefs.v6';
const LEGACY_USER = 'chesslens.username';
const LEGACY_PGN_V6 = 'chesslens.lastpgn.v6';
const LEGACY_PGN = 'chesslens.lastpgn';
const LEGACY_CACHE_V6 = 'chesslens.cache.v6';
const LEGACY_CACHE = 'chesslens.cache.v5';
const CDN_CACHE = 'chesslens-cdn-v7'; // must match sw.js
const MAX_CACHED_GAMES = 10;
const MAX_PROFILES = 20;
const USER_RE = /^[A-Za-z0-9_-]{2,30}$/;

const BOARD_THEMES = [
  { id: 'green',    name: 'Green',    light: '#ebecd0', dark: '#739552' },
  { id: 'wood',     name: 'Wood',     light: '#edd6b0', dark: '#b88762' },
  { id: 'slate',    name: 'Slate',    light: '#c9d1da', dark: '#6b7a8f' },
  { id: 'midnight', name: 'Midnight', light: '#8d99ab', dark: '#475569' }
];
const PIECE_STYLES = [
  { id: 'neo',     name: 'Neo' },
  { id: 'classic', name: 'Classic' },
  { id: 'bold',    name: 'Bold' },
  { id: 'flat',    name: 'Flat' },
  { id: 'gold',    name: 'Gold' }
];

const NEO_PIECE_FILE = {
  wp: 'WhitePawn.png',
  wn: 'WhiteKnight.png',
  wb: 'WhiteBishop.png',
  wr: 'WhiteRook.png',
  wq: 'WhiteQueen.png',
  wk: 'WhiteKing.png',
  bp: 'BlackPawn.png',
  bn: 'BlackKnight.png',
  bb: 'BlackBishop.png',
  br: 'BlackRook.png',
  bq: 'BlackQueen.png',
  bk: 'BlackKing.png'
};

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const GLYPH = { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
const TEXT_VS = '\uFE0E';

const CLS = {
  brilliant:  { label: 'Brilliant',  sym: '!!', color: '#26c2a3', fg: '#fff' },
  great:      { label: 'Great',      sym: '!',  color: '#5c8bb0', fg: '#fff' },
  best:       { label: 'Best',       sym: '\u2605', color: '#81b64c', fg: '#fff' },
  good:       { label: 'Good',       sym: '\u2713', color: '#96af8b', fg: '#fff' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#f7c631', fg: '#262421' },
  mistake:    { label: 'Mistake',    sym: '?',  color: '#e58f2a', fg: '#fff' },
  blunder:    { label: 'Blunder',    sym: '??', color: '#ca3431', fg: '#fff' }
};
const CLS_ORDER = ['brilliant', 'great', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'];

const ENGINE_SOURCES = [
  { name: 'Stockfish WASM (cdnjs)',
    js: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.wasm.js',
    wasm: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.wasm' },
  { name: 'Stockfish WASM (jsDelivr)',
    js: 'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.wasm.js',
    wasm: 'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.wasm' },
  { name: 'Stockfish asm.js (cdnjs)',
    js: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js' },
  { name: 'Stockfish asm.js (jsDelivr)',
    js: 'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.js' }
];

const SAMPLE_PGN = [
  '[Event "Paris Opera House"]',
  '[Site "Paris FRA"]',
  '[Date "1858.??.??"]',
  '[White "Paul Morphy"]',
  '[Black "Duke Karl / Count Isouard"]',
  '[Result "1-0"]',
  '',
  '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7',
  '8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7',
  '14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'
].join('\n');

const $ = (sel, root) => (root || document).querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = (arr, i) => arr[Math.abs(i) % arr.length];

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

function winPct(cp) {
  if (cp >= 9000) return 100;
  if (cp <= -9000) return 0;
  const c = clamp(cp, -1000, 1000);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function fmtEval(a) {
  if (!a) return '\u2026';
  if (a.mate === 0) return a.cp > 0 ? '1-0' : '0-1';
  if (a.mate != null) return (a.mate > 0 ? '+' : '-') + 'M' + Math.abs(a.mate);
  const v = a.cp / 100;
  return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(1);
}
function fmtBarLabel(a) {
  if (!a) return '0.0';
  if (a.mate === 0) return a.cp > 0 ? '1-0' : '0-1';
  if (a.mate != null) return 'M' + Math.abs(a.mate);
  return (Math.abs(a.cp) / 100).toFixed(1);
}

function evalSentence(a) {
  if (!a || a.mate === 0) return '';
  if (a.mate != null) return (a.mate > 0 ? 'White' : 'Black') + ' has a forced mate in ' + Math.abs(a.mate) + '.';
  const abs = Math.abs(a.cp);
  const w = a.cp > 0 ? 'White' : 'Black';
  if (abs < 25) return 'The position is roughly equal.';
  if (abs < 90) return w + ' is slightly better.';
  if (abs < 250) return w + ' is clearly better.';
  if (abs < 600) return w + ' has a big advantage.';
  return w + ' is completely winning.';
}

const state = {
  game: null,
  ply: 0,
  flipped: false,
  myColor: null,
  analysis: [],
  results: [],
  doneCount: 0,
  token: 0,
  engineError: false,
  moveEls: [],
  listGames: [],
  listUser: '',
  listReq: 0,
  listLoadingFor: '',
  username: '',
  profiles: [],
  prefs: { board: 'green', pieces: 'neo' }
};

function pieceHtml(type, color, styleOverride) {
  const style = styleOverride || state.prefs.pieces;
  if (style === 'neo') {
    const file = NEO_PIECE_FILE[color + type];
    if (file) {
      return '<img class="pc-img" src="./pieces/neo/' + file + '" alt="" draggable="false">';
    }
  }
  return '<span class="pc ' + color + '">' + GLYPH[type] + TEXT_VS + '</span>';
}

/* =====================================================================
   Preferences (board theme + piece style)
   ===================================================================== */
function loadPrefs() {
  try {
    const raw = lsGet(LS_PREFS) || lsGet(LEGACY_PREFS);
    const o = JSON.parse(raw || '{}');
    if (o && BOARD_THEMES.some((t) => t.id === o.board)) state.prefs.board = o.board;
    if (o && PIECE_STYLES.some((s) => s.id === o.pieces)) state.prefs.pieces = o.pieces;
  } catch (e) { /* ignore */ }
}
function applyPrefs() {
  const root = document.documentElement;
  root.setAttribute('data-board', state.prefs.board);
  root.setAttribute('data-pieces', state.prefs.pieces);
}
function setPref(key, val) {
  state.prefs[key] = val;
  lsSet(LS_PREFS, JSON.stringify(state.prefs));
  applyPrefs();
  renderAppearance();
  buildPreview(true);
  renderBoard();
}

/* =====================================================================
   Profiles (saved Chess.com usernames)
   ===================================================================== */
function findProfile(name) {
  const k = String(name || '').toLowerCase();
  return state.profiles.find((n) => n.toLowerCase() === k) || null;
}

function saveProfiles() {
  lsSet(LS_PROFILES, JSON.stringify({ list: state.profiles, active: state.username }));
}

function loadProfiles() {
  let list = [];
  let active = '';
  const raw = lsGet(LS_PROFILES) || lsGet(LEGACY_PROFILES);
  try {
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.list)) list = o.list.filter((x) => typeof x === 'string' && USER_RE.test(x));
      if (o && typeof o.active === 'string') active = o.active;
    } else {
      const legacy = (lsGet(LEGACY_USER) || '').trim();
      if (legacy && USER_RE.test(legacy)) { list = [legacy]; active = legacy; }
    }
  } catch (e) { list = []; active = ''; }
  const seen = {};
  list = list.filter((n) => {
    const k = n.toLowerCase();
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
  state.profiles = list;
  const match = list.find((n) => n.toLowerCase() === active.toLowerCase());
  state.username = match || list[0] || '';
  if (!lsGet(LS_PROFILES) && list.length) saveProfiles();
}

function setActiveProfile(name) {
  const next = name || '';
  const changed = next.toLowerCase() !== (state.username || '').toLowerCase();
  state.username = next;
  saveProfiles();
  if (changed) {
    state.listReq++;
    state.listGames = [];
    state.listUser = '';
    state.listLoadingFor = '';
    $('#glist').innerHTML = '';
    setMsg('#user-msg', '');
    $('#btn-load-games').disabled = false;
    refreshColor();
  }
  const inp = $('#in-user');
  if (inp) inp.value = state.username;
  renderProfileList();
  renderUserChips();
}

function addProfile(raw) {
  const name = String(raw || '').trim().replace(/^@/, '');
  if (!USER_RE.test(name)) return { error: 'Usernames use 2\u201330 letters, numbers, "_" or "-".' };
  const existing = findProfile(name);
  if (existing) { setActiveProfile(existing); return { ok: true, name: existing, existed: true }; }
  if (state.profiles.length >= MAX_PROFILES) return { error: 'You can save up to ' + MAX_PROFILES + ' profiles.' };
  state.profiles.push(name);
  setActiveProfile(name);
  return { ok: true, name };
}

function removeProfile(name) {
  const k = String(name || '').toLowerCase();
  const wasActive = (state.username || '').toLowerCase() === k;
  state.profiles = state.profiles.filter((n) => n.toLowerCase() !== k);
  if (wasActive) {
    setActiveProfile(state.profiles[0] || '');
  } else {
    saveProfiles();
    renderProfileList();
    renderUserChips();
  }
}

/* Re-detect which side the active profile played in the open game */
function refreshColor() {
  if (!state.game) return;
  const mc = detectMyColor(state.game.headers);
  state.myColor = mc;
  if (mc) {
    state.flipped = mc === 'b';
    render();
  }
}

function renderProfileList() {
  const el = $('#profile-list');
  if (!el) return;
  if (!state.profiles.length) {
    el.innerHTML = '<p class="set-empty">No saved profiles yet. Add your Chess.com username below.</p>';
    return;
  }
  const active = (state.username || '').toLowerCase();
  el.innerHTML = state.profiles.map((n) => {
    const on = n.toLowerCase() === active;
    return '<div class="prof' + (on ? ' active' : '') + '">' +
      '<button class="prof-main" data-profile="' + esc(n) + '" aria-pressed="' + on + '">' +
      '<span class="prof-dot"></span><span class="prof-name">' + esc(n) + '</span>' +
      (on ? '<small>Active</small>' : '') + '</button>' +
      '<button class="icon-btn prof-del" data-remove-profile="' + esc(n) + '" aria-label="Remove ' + esc(n) + '">\u2715</button>' +
      '</div>';
  }).join('');
}

function renderUserChips() {
  const el = $('#user-chips');
  if (!el) return;
  if (state.profiles.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
  const active = (state.username || '').toLowerCase();
  el.hidden = false;
  el.innerHTML = state.profiles.map((n) =>
    '<button class="chip" data-chip="' + esc(n) + '" aria-pressed="' + (n.toLowerCase() === active) + '">' + esc(n) + '</button>'
  ).join('');
}

/* =====================================================================
   Appearance pickers + preview
   ===================================================================== */
function renderAppearance() {
  const bt = $('#board-themes');
  const ps = $('#piece-styles');
  if (!bt || !ps) return;
  bt.innerHTML = BOARD_THEMES.map((t) =>
    '<button class="opt" data-board-id="' + t.id + '" aria-pressed="' + (state.prefs.board === t.id) + '">' +
    '<span class="sw"><i style="background:' + t.light + '"></i><i style="background:' + t.dark + '"></i>' +
    '<i style="background:' + t.dark + '"></i><i style="background:' + t.light + '"></i></span>' +
    '<span>' + esc(t.name) + '</span></button>'
  ).join('');
  ps.innerHTML = PIECE_STYLES.map((s) =>
    '<button class="opt" data-piece-id="' + s.id + '" aria-pressed="' + (state.prefs.pieces === s.id) + '">' +
    '<span class="ptile" data-pieces="' + s.id + '">' +
    '<span class="sq l">' + pieceHtml('n', 'w', s.id) + '</span>' +
    '<span class="sq d">' + pieceHtml('n', 'b', s.id) + '</span></span>' +
    '<span>' + esc(s.name) + '</span></button>'
  ).join('');
}

function buildPreview(force) {
  const el = $('#prev-board');
  if (!el) return;
  if (!force && el.dataset.built === state.prefs.pieces) return;
  const rows = ['rnbqkbnr', 'pppppppp', 'PPPPPPPP', 'RNBQKBNR'];
  let h = '';
  rows.forEach((row, r) => {
    for (let c = 0; c < 8; c++) {
      const ch = row[c];
      const color = ch === ch.toLowerCase() ? 'b' : 'w';
      const light = (r + c) % 2 === 0;
      h += '<div class="sq ' + (light ? 'l' : 'd') + '">' + pieceHtml(ch.toLowerCase(), color) + '</div>';
    }
  });
  el.innerHTML = h;
  el.dataset.built = state.prefs.pieces;
}

function parsePgn(text) {
  const src = String(text || '').replace(/\r/g, '').trim();
  if (!src) throw new Error('Paste a PGN first.');

  const firstGame = src.split(/\n\s*\n(?=\[Event\s)/)[0];
  const headers = {};
  const bodyLines = [];
  firstGame.split('\n').forEach((line) => {
    const m = line.match(/^\s*\[(\w+)\s+"(.*)"\s*\]\s*$/);
    if (m) headers[m[1]] = m[2]; else bodyLines.push(line);
  });

  let mt = bodyLines.join('\n')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ');
  let guard = 0;
  while (/\([^()]*\)/.test(mt) && guard++ < 20) mt = mt.replace(/\([^()]*\)/g, ' ');
  mt = mt.replace(/\$\d+/g, ' ')
    .replace(/\d+\.+/g, ' ')
    .replace(/\b0-0-0\b/g, 'O-O-O')
    .replace(/\b0-0\b/g, 'O-O');

  const tokens = mt.split(/\s+/)
    .map((t) => t.replace(/[!?]+$/, ''))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));

  const ch = new Chess();
  if (headers.SetUp === '1' && headers.FEN) {
    if (!ch.load(headers.FEN)) throw new Error('The FEN in this PGN is not valid.');
  }
  const startFen = ch.fen();
  const moves = [];
  const fens = [startFen];
  for (let i = 0; i < tokens.length; i++) {
    const m = ch.move(tokens[i], { sloppy: true });
    if (!m) throw new Error('Could not read move "' + tokens[i] + '" (move ' + (Math.floor(i / 2) + 1) + '). Check the PGN.');
    moves.push(m);
    fens.push(ch.fen());
  }
  if (!moves.length) throw new Error('No moves found in that PGN.');
  return { headers, startFen, moves, fens, key: hashStr(fens.join('|')) };
}

function detectMyColor(headers) {
  const u = (state.username || '').trim().toLowerCase();
  if (!u) return null;
  if ((headers.White || '').toLowerCase() === u) return 'w';
  if ((headers.Black || '').toLowerCase() === u) return 'b';
  return null;
}

function loadCache(key) {
  try {
    const raw = lsGet(LS_CACHE);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && obj.data && obj.data[key]) || null;
  } catch (e) { return null; }
}
function saveCache(key, analysis) {
  try {
    const raw = lsGet(LS_CACHE);
    const obj = raw ? JSON.parse(raw) : { order: [], data: {} };
    if (!obj.order) obj.order = [];
    if (!obj.data) obj.data = {};
    obj.order = obj.order.filter((k) => k !== key);
    obj.order.push(key);
    obj.data[key] = analysis;
    while (obj.order.length > MAX_CACHED_GAMES) delete obj.data[obj.order.shift()];
    lsSet(LS_CACHE, JSON.stringify(obj));
  } catch (e) { /* ignore */ }
}

async function getAsset(url) {
  let cache = null;
  try { cache = await caches.open(CDN_CACHE); } catch (e) { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.blob();
  }
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  if (cache) { try { await cache.put(url, res.clone()); } catch (e) { /* ignore */ } }
  return res.blob();
}

async function spawnWorker(src) {
  const jsBlob = await getAsset(src.js);
  const jsUrl = URL.createObjectURL(new Blob([jsBlob], { type: 'application/javascript' }));
  let wrapper;
  let hash = '';
  if (src.wasm) {
    const wasmBlob = await getAsset(src.wasm);
    const wasmUrl = URL.createObjectURL(new Blob([wasmBlob], { type: 'application/wasm' }));
    wrapper = 'self.Module={locateFile:function(){return ' + JSON.stringify(wasmUrl) + ';}};' +
              'importScripts(' + JSON.stringify(jsUrl) + ');';
    hash = '#' + wasmUrl;
  } else {
    wrapper = 'importScripts(' + JSON.stringify(jsUrl) + ');';
  }
  const wrapUrl = URL.createObjectURL(new Blob([wrapper], { type: 'application/javascript' }));
  return new Worker(wrapUrl + hash);
}

const engine = {
  worker: null,
  status: 'idle',
  handler: null,
  initPromise: null,
  label: '',
  currentMultiPv: 1,

  init() {
    if (this.initPromise) return this.initPromise;
    this.status = 'loading';
    this.initPromise = (async () => {
      for (const src of ENGINE_SOURCES) {
        try {
          await this.start(src);
          this.status = 'ready';
          this.label = src.name;
          return true;
        } catch (err) {
          console.warn('[ChessLens] engine source failed:', src.name, err);
          this.teardown();
        }
      }
      this.status = 'failed';
      this.initPromise = null;
      return false;
    })();
    return this.initPromise;
  },

  async start(src) {
    this.worker = await spawnWorker(src);
    this.worker.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : '';
      data.split('\n').forEach((line) => {
        const l = line.trim();
        if (l && this.handler) this.handler(l);
      });
    };
    this.worker.onerror = () => { if (this.handler) this.handler('__error__'); };
    await this.command('uci', 'uciok', 30000);
    this.currentMultiPv = 1;
    this.post('setoption name MultiPV value 1');
    await this.command('isready', 'readyok', 20000);
  },

  setMultiPv(n) {
    if (this.currentMultiPv === n) return;
    this.currentMultiPv = n;
    this.post('setoption name MultiPV value ' + n);
  },

  teardown() {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignore */ } }
    this.worker = null;
    this.handler = null;
  },

  post(cmd) { if (this.worker) this.worker.postMessage(cmd); },

  command(cmd, waitFor, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.handler = null; reject(new Error('Timed out waiting for ' + waitFor)); }, timeout);
      this.handler = (line) => {
        if (line === '__error__') { clearTimeout(timer); this.handler = null; reject(new Error('Worker error')); }
        else if (line === waitFor || line.indexOf(waitFor) === 0) { clearTimeout(timer); this.handler = null; resolve(); }
      };
      this.post(cmd);
    });
  },

  stop() { if (this.worker && this.status === 'ready') this.post('stop'); },

  analyze(fen, depth, multiPv, movetime) {
    return new Promise((resolve, reject) => {
      this.setMultiPv(multiPv || 1);
      const lines = {};
      const dog = setTimeout(() => this.post('stop'), 25000);
      this.handler = (line) => {
        if (line === '__error__') {
          clearTimeout(dog); this.handler = null; reject(new Error('Engine stopped unexpectedly'));
          return;
        }
        if (line.indexOf('info') === 0 && line.indexOf(' pv ') > 0 && !/bound/.test(line)) {
          const sc = line.match(/score (cp|mate) (-?\d+)/);
          if (!sc) return;
          const mp = line.match(/multipv (\d+)/);
          const dp = line.match(/depth (\d+)/);
          const move = line.split(' pv ')[1].trim().split(/\s+/)[0];
          lines[mp ? +mp[1] : 1] = {
            depth: dp ? +dp[1] : 0,
            cp: sc[1] === 'cp' ? +sc[2] : null,
            mate: sc[1] === 'mate' ? +sc[2] : null,
            move
          };
        } else if (line.indexOf('bestmove') === 0) {
          clearTimeout(dog);
          this.handler = null;
          resolve({ lines, best: line.split(/\s+/)[1] });
        }
      };
      this.post('position fen ' + fen);
      this.post('go depth ' + depth + ' movetime ' + (movetime || MOVETIME_MS));
    });
  }
};

function bestCapture(ch) {
  const out = { net: 0, move: null };
  if (ch.game_over()) return out;
  const list = ch.moves({ verbose: true });
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m.captured) continue;
    ch.move(m);
    const recaptured = ch.moves({ verbose: true }).some((x) => x.to === m.to && x.captured);
    ch.undo();
    let net = VAL[m.captured] - (recaptured ? VAL[m.piece] : 0);
    if (m.promotion) net += VAL[m.promotion] - 1;
    if (net > out.net) { out.net = net; out.move = m; }
  }
  return out;
}

function findThreat(fenAfter, color) {
  try {
    const parts = fenAfter.split(' ');
    parts[1] = color;
    parts[3] = '-';
    const t = new Chess();
    if (!t.load(parts.join(' '))) return null;
    const bc = bestCapture(t);
    return bc.net >= 2 ? bc : null;
  } catch (e) { return null; }
}

function toWhite(line, turn) {
  const s = turn === 'w' ? 1 : -1;
  if (line.mate != null) {
    const v = (line.mate > 0 ? 1 : -1) * (10000 - Math.min(Math.abs(line.mate), 99) * 10);
    return { cp: v * s, mate: line.mate * s };
  }
  return { cp: line.cp * s, mate: null };
}

function uciToMove(u) {
  return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined };
}

async function analyzePosition(g, i) {
  const fen = g.fens[i];
  const ch = new Chess();
  ch.load(fen);
  const turn = ch.turn();
  if (ch.in_checkmate()) return { cp: turn === 'w' ? -10000 : 10000, mate: 0, best: null, second: null };
  if (ch.game_over()) return { cp: 0, mate: null, best: null, second: null };

  const playedMove = i < g.moves.length ? g.moves[i] : null;
  const playedUci = playedMove ? (playedMove.from + playedMove.to + (playedMove.promotion || '')) : null;
  const isOpening = i < 6;
  const useMultiPv = !isOpening && !!(playedMove && (playedMove.captured || playedMove.flags.indexOf('+') >= 0 || i >= 8));
  const mt = isOpening ? 280 : MOVETIME_MS;

  const res = await engine.analyze(fen, DEPTH, useMultiPv ? 2 : 1, mt);
  const l1 = res.lines[1];
  if (!l1) return { cp: 0, mate: null, best: res.best && res.best !== '(none)' ? res.best : null, second: null };
  const w1 = toWhite(l1, turn);
  const bestUci = res.best && res.best !== '(none)' ? res.best : l1.move;
  const w2 = (useMultiPv && res.lines[2] && bestUci === playedUci) ? toWhite(res.lines[2], turn) : null;
  return {
    cp: w1.cp,
    mate: w1.mate,
    best: bestUci,
    second: w2 ? { cp: w2.cp, mate: w2.mate } : null
  };
}

function computeMoveResult(k) {
  const g = state.game;
  const mv = g.moves[k];
  const A = state.analysis[k];
  const B = state.analysis[k + 1];
  const sgn = mv.color === 'w' ? 1 : -1;
  const winBefore = winPct(A.cp * sgn);
  const winAfter = winPct(B.cp * sgn);
  const uci = mv.from + mv.to + (mv.promotion || '');
  const isBest = !!A.best && uci === A.best;
  const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);
  const inaccCutoff = k < 6 ? 8 : 5;

  let cls;
  if (isBest || loss <= 0.4) cls = 'best';
  else if (loss < inaccCutoff) cls = 'good';
  else if (loss < 10) cls = 'inaccuracy';
  else if (loss < 20) cls = 'mistake';
  else cls = 'blunder';
  if ((cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder') && winBefore >= 93 && winAfter >= 75) cls = 'good';

  let sac = false;
  let onlyMove = false;
  if (cls === 'best' || cls === 'good') {
    const after = new Chess();
    after.load(g.fens[k + 1]);
    const gain = (mv.captured ? VAL[mv.captured] : 0) + (mv.promotion ? VAL[mv.promotion] - 1 : 0);
    const risk = after.game_over() ? 0 : bestCapture(after).net;
    sac = (gain - risk) <= -2;
    const mateForMe = A.mate != null && A.mate !== 0 && Math.sign(A.mate) === sgn;
    if (sac && loss <= 2 && winAfter >= 40 && (winBefore <= 92 || mateForMe)) {
      cls = 'brilliant';
    } else if (isBest && cls === 'best' && A.second) {
      const prev = k > 0 ? g.moves[k - 1] : null;
      const recapture = !!(prev && prev.captured && mv.captured && prev.to === mv.to);
      const diff = winBefore - winPct(A.second.cp * sgn);
      if (diff >= (recapture ? 30 : 15)) { cls = 'great'; onlyMove = true; }
    }
  }

  let bestSan = null;
  let bestMove = null;
  if (A.best) {
    const ch = new Chess();
    ch.load(g.fens[k]);
    const bm = ch.move(uciToMove(A.best));
    if (bm) { bestSan = bm.san; bestMove = bm; }
  }
  state.results[k] = { cls, loss, winBefore, winAfter, isBest, sac, onlyMove, bestSan, bestMove, comment: null };
}

let runChain = Promise.resolve();
let wakeLock = null;

async function acquireWake() {
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
}
function releaseWake() {
  try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
}

function startAnalysis() {
  const g = state.game;
  const token = ++state.token;
  engine.stop();
  runChain = runChain.catch(() => {}).then(() => analyzeGame(g, token));
}

async function analyzeGame(g, token) {
  if (token !== state.token || !g) return;
  const n = g.fens.length;
  state.analysis = new Array(n).fill(null);
  state.results = new Array(n - 1).fill(null);
  state.doneCount = 0;
  state.engineError = false;

  const cached = loadCache(g.key);
  if (cached && cached.length === n) {
    state.analysis = cached;
    for (let k = 0; k < n - 1; k++) { computeMoveResult(k); updateMoveTag(k); }
    state.doneCount = n;
    hideStatus();
    render();
    return;
  }

  setStatus('Loading engine\u2026', null);
  const ok = await engine.init();
  if (token !== state.token) return;
  if (!ok) {
    state.engineError = true;
    hideStatus();
    render();
    return;
  }

  await acquireWake();
  try {
    for (let i = 0; i < n; i++) {
      if (token !== state.token) return;
      const a = await analyzePosition(g, i);
      if (token !== state.token) return;
      state.analysis[i] = a;
      if (i > 0) { computeMoveResult(i - 1); updateMoveTag(i - 1); }
      state.doneCount = i + 1;
      setStatus('Scanning positions ' + (i + 1) + ' / ' + n + ' (depth ' + DEPTH + ')', (i + 1) / n);
      if (Math.abs(state.ply - i) <= 1) render();
    }
    saveCache(g.key, state.analysis);
    hideStatus();
    render();
  } catch (err) {
    console.warn('[ChessLens] analysis failed', err);
    if (token === state.token) {
      state.engineError = true;
      engine.teardown();
      engine.status = 'failed';
      engine.initPromise = null;
      hideStatus();
      render();
    }
  } finally {
    releaseWake();
  }
}

function describeMove(c) {
  const m = c.move;
  const piece = NAME[m.piece];
  const prev = c.prev;
  const flags = m.flags || '';
  let s;
  if (flags.indexOf('k') >= 0) s = (c.color === 'w' ? 'White' : 'Black') + ' castles kingside';
  else if (flags.indexOf('q') >= 0) s = (c.color === 'w' ? 'White' : 'Black') + ' castles queenside';
  else if (flags.indexOf('e') >= 0) s = 'The pawn captures en passant on ' + m.to;
  else if (m.captured) {
    if (prev && prev.captured && prev.to === m.to) s = 'The ' + piece + ' recaptures the ' + NAME[m.captured] + ' on ' + m.to;
    else s = 'The ' + piece + ' captures the ' + NAME[m.captured] + ' on ' + m.to;
  } else if (m.piece === 'p') s = 'A pawn advances to ' + m.to;
  else s = 'The ' + piece + ' moves to ' + m.to;
  if (m.promotion) s += ', promoting to a ' + NAME[m.promotion];
  if (/#/.test(m.san)) s += ' and delivers checkmate';
  else if (/\+/.test(m.san)) s += ' with check';
  return m.san + ' \u2014 ' + s + '.';
}

function generateCommentary(c) {
  const m = c.move;
  const S = c.index;
  const sgn = c.color === 'w' ? 1 : -1;
  const who = c.color === 'w' ? 'White' : 'Black';
  const opp = c.color === 'w' ? 'Black' : 'White';
  const A = c.evalBefore;
  const B = c.evalAfter;
  const cls = c.cls;
  const out = [describeMove(c)];

  if (c.isMate) { out.push("That's checkmate \u2014 " + who + ' wins the game.'); return out.join(' '); }
  if (c.isDraw) { out.push(c.after.in_stalemate() ? 'The game ends in stalemate \u2014 a draw.' : 'The game ends in a draw.'); return out.join(' '); }

  const mateMine = A.mate != null && A.mate !== 0 && Math.sign(A.mate) === sgn;
  const keptMate = B.mate != null && B.mate !== 0 && Math.sign(B.mate) === sgn;
  const mateTheirs = B.mate != null && B.mate !== 0 && Math.sign(B.mate) === -sgn;
  const mA = A.cp * sgn;
  const mB = B.cp * sgn;
  let bestHandled = false;
  const extras = [];

  if (cls === 'best' || cls === 'good' || cls === 'great' || cls === 'brilliant') {
    const flags = m.flags || '';
    if (m.captured) {
      const recap = c.after.moves({ verbose: true }).some((x) => x.to === m.to && x.captured);
      if (!recap && VAL[m.captured] >= 1 && !(c.prev && c.prev.captured && c.prev.to === m.to)) {
        extras.push('It wins ' + (VAL[m.captured] >= 3 ? 'a ' + NAME[m.captured] : 'a pawn') + ' without allowing a recapture.');
      } else if (recap && VAL[m.captured] === VAL[m.piece]) {
        extras.push('An even trade that simplifies the position.');
      }
    }
    if (flags.indexOf('k') >= 0 || flags.indexOf('q') >= 0) extras.push('Castling tucks the king away and brings a rook into play.');
    else if (S < 12 && (m.piece === 'n' || m.piece === 'b') && !m.captured && (m.from[1] === '1' || m.from[1] === '8')) {
      extras.push('It develops the ' + NAME[m.piece] + ' toward the center.');
    } else if (S < 8 && m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].indexOf(m.to) >= 0) {
      extras.push('It stakes a claim in the center.');
    }
    if (!c.inCheck && extras.length < 2) {
      const th = findThreat(c.fenAfter, c.color);
      if (th) extras.push('It also threatens to win the ' + NAME[th.move.captured] + ' on ' + th.move.to + ' with ' + th.move.san + '.');
    }
    if (keptMate && extras.length < 2) extras.push(who + ' now has a forced checkmate.');
  }

  if (cls === 'brilliant') {
    out.push(pick([
      'A brilliant sacrifice! Giving up material here is the engine\u2019s top choice.',
      'Brilliant! This sacrifice looks risky but the engine confirms it.',
      'A stunning idea \u2014 the material given up is more than repaid by the attack.'
    ], S));
    out.push(c.winAfter >= 60 ? 'It keeps ' + who + ' firmly in control.' : 'It keeps the balance while creating real problems for ' + opp + '.');
  } else if (cls === 'great') {
    out.push(pick([
      'A great find! This is nearly the only move that holds things together.',
      'Great move \u2014 most alternatives here would lose ground quickly.',
      'Sharp play: the engine\u2019s clear first choice, with little else working.'
    ], S));
  } else if (cls === 'best') {
    out.push(pick([
      'This is the engine\u2019s top choice.',
      'Exactly what the engine wants to see.',
      'The best move in the position.'
    ], S));
  } else if (cls === 'good') {
    out.push(pick([
      'A solid, sensible move that keeps things under control.',
      'A good move, though not the very top choice.',
      'Reasonable \u2014 it doesn\u2019t give anything significant away.'
    ], S));
    if (c.bestSan && c.loss > 1.5) { out.push('The engine slightly preferred ' + c.bestSan + '.'); bestHandled = true; }
  } else {
    const head = {
      inaccuracy: ['A small slip \u2014 it gives back part of the advantage.', 'An inaccuracy: playable, but there was something better.'],
      mistake: ['This is a mistake that noticeably shifts the evaluation.', 'A mistake \u2014 the position gets harder to hold.'],
      blunder: ['A blunder \u2014 this throws away a large part of the position.', 'That\u2019s a serious blunder that swings the game.']
    }[cls];
    out.push(pick(head, S));

    let reason = null;
    if (mateTheirs) {
      reason = 'It allows ' + opp + ' to force checkmate in ' + Math.abs(B.mate) + '.';
    } else if (mateMine && !keptMate) {
      reason = 'It misses a forced checkmate in ' + Math.abs(A.mate) + (c.bestSan ? ' \u2014 ' + c.bestSan + ' was the way to go.' : '.');
      if (c.bestSan) bestHandled = true;
    } else {
      const hang = bestCapture(c.after);
      if (hang.net >= 2 && hang.move) {
        reason = 'It leaves the ' + NAME[hang.move.captured] + ' on ' + hang.move.to + ' hanging \u2014 ' + hang.move.san + ' wins material.';
      } else {
        const before = new Chess();
        before.load(c.fenBefore);
        const free = bestCapture(before);
        if (free.net >= 2 && free.move && c.bestUci && free.move.from + free.move.to + (free.move.promotion || '') === c.bestUci) {
          reason = 'It overlooks a chance to win a ' + NAME[free.move.captured] + ' with ' + free.move.san + '.';
          bestHandled = true;
        }
      }
    }
    if (!reason) {
      if (mA >= 60 && mB <= -60) reason = 'A winning position turns into a losing one (' + fmtEval(A) + ' \u2192 ' + fmtEval(B) + ').';
      else if (mA >= 60) reason = 'Most of ' + who + '\u2019s advantage evaporates (' + fmtEval(A) + ' \u2192 ' + fmtEval(B) + ').';
      else if (mA > -60 && mB <= -60) reason = opp + ' now has the upper hand (' + fmtEval(A) + ' \u2192 ' + fmtEval(B) + ').';
      else reason = 'The evaluation moves from ' + fmtEval(A) + ' to ' + fmtEval(B) + ' against ' + who + '.';
    }
    out.push(reason);

    if (!bestHandled && c.bestSan && !c.isBest) {
      const bm = c.bestMove;
      let note = '';
      if (bm) {
        if (/#/.test(bm.san)) note = ' (checkmate)';
        else if (/\+/.test(bm.san)) note = ' (check)';
        else if (bm.captured) note = ' (captures the ' + NAME[bm.captured] + ')';
      }
      out.push('Better was ' + c.bestSan + note + '.');
    }
  }

  for (let i = 0; i < extras.length && i < 2; i++) out.push(extras[i]);
  const tail = evalSentence(B);
  if (tail) out.push(tail);
  return out.join(' ');
}

function buildContext(k) {
  const g = state.game;
  const mv = g.moves[k];
  const R = state.results[k];
  const after = new Chess();
  after.load(g.fens[k + 1]);
  return {
    index: k,
    move: mv,
    color: mv.color,
    prev: k > 0 ? g.moves[k - 1] : null,
    cls: R.cls,
    loss: R.loss,
    winBefore: R.winBefore,
    winAfter: R.winAfter,
    isBest: R.isBest,
    bestSan: R.bestSan,
    bestMove: R.bestMove,
    bestUci: state.analysis[k].best,
    evalBefore: state.analysis[k],
    evalAfter: state.analysis[k + 1],
    fenBefore: g.fens[k],
    fenAfter: g.fens[k + 1],
    after,
    isMate: after.in_checkmate(),
    isDraw: after.game_over() && !after.in_checkmate(),
    inCheck: after.in_check()
  };
}

function commentFor(k) {
  const R = state.results[k];
  if (!R) return null;
  if (!R.comment) {
    try { R.comment = generateCommentary(buildContext(k)); }
    catch (e) { console.warn(e); R.comment = state.game.moves[k].san + ' \u2014 ' + CLS[R.cls].label + '.'; }
  }
  return R.comment;
}

/* =====================================================================
   Rendering (L-shaped knight arrows + turn-based best pick)
   ===================================================================== */
function sqXY(sq) {
  let f = sq.charCodeAt(0) - 97;
  let r = 8 - parseInt(sq[1], 10);
  if (state.flipped) { f = 7 - f; r = 7 - r; }
  return { x: f + 0.5, y: r + 0.5 };
}

function drawHead(tipX, tipY, dirX, dirY) {
  const headLen = 0.36;
  const halfW = 0.22;
  const baseX = tipX - dirX * headLen;
  const baseY = tipY - dirY * headLen;
  const px = -dirY;
  const py = dirX;
  return '<polygon stroke="none" points="' +
    tipX.toFixed(3) + ',' + tipY.toFixed(3) + ' ' +
    (baseX + px * halfW).toFixed(3) + ',' + (baseY + py * halfW).toFixed(3) + ' ' +
    (baseX - px * halfW).toFixed(3) + ',' + (baseY - py * halfW).toFixed(3) + '"/>';
}

function arrowSvg(from, to) {
  const a = sqXY(from);
  const b = sqXY(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.round(Math.abs(dx));
  const ady = Math.round(Math.abs(dy));

  if ((adx === 1 && ady === 2) || (adx === 2 && ady === 1)) {
    const sx = a.x + Math.sign(dx) * 0.12;
    const sy = a.y + Math.sign(dy) * 0.12;
    let elbowX;
    let elbowY;
    let dirX;
    let dirY;
    if (adx === 2) {
      elbowX = b.x;
      elbowY = sy;
      dirX = 0;
      dirY = dy >= 0 ? 1 : -1;
    } else {
      elbowX = sx;
      elbowY = b.y;
      dirX = dx >= 0 ? 1 : -1;
      dirY = 0;
    }
    const tipX = b.x - dirX * 0.14;
    const tipY = b.y - dirY * 0.14;
    const shaftEndX = tipX - dirX * 0.22;
    const shaftEndY = tipY - dirY * 0.22;
    const dPath = 'M ' + sx.toFixed(3) + ' ' + sy.toFixed(3) +
                  ' L ' + elbowX.toFixed(3) + ' ' + elbowY.toFixed(3) +
                  ' L ' + shaftEndX.toFixed(3) + ' ' + shaftEndY.toFixed(3);
    return '<g opacity=".9" fill="#ffb02e" stroke="#ffb02e">' +
      '<path fill="none" d="' + dPath + '" stroke-width=".17" stroke-linecap="round" stroke-linejoin="round"/>' +
      drawHead(tipX, tipY, dirX, dirY) + '</g>';
  }

  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tipX = b.x - ux * 0.08;
  const tipY = b.y - uy * 0.08;
  const baseX = tipX - ux * 0.36;
  const baseY = tipY - uy * 0.36;
  const sx = a.x + ux * 0.18;
  const sy = a.y + uy * 0.18;
  return '<g opacity=".85" fill="#ffb02e" stroke="#ffb02e">' +
    '<line x1="' + sx.toFixed(3) + '" y1="' + sy.toFixed(3) + '" x2="' + baseX.toFixed(3) + '" y2="' + baseY.toFixed(3) + '" stroke-width=".17" stroke-linecap="round"/>' +
    drawHead(tipX, tipY, ux, uy) + '</g>';
}

function currentFen() {
  return state.game ? state.game.fens[state.ply] : START_FEN;
}

function renderBoard() {
  const boardEl = $('#board');
  const ch = new Chess();
  ch.load(currentFen());
  const bd = ch.board();
  const g = state.game;
  const last = g && state.ply > 0 ? g.moves[state.ply - 1] : null;

  let checkSq = null;
  if (ch.in_check()) {
    const turn = ch.turn();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = bd[r][f];
      if (p && p.type === 'k' && p.color === turn) checkSq = 'abcdefgh'[f] + (8 - r);
    }
  }

  let html = '';
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const file = state.flipped ? 7 - dc : dc;
      const rowIdx = state.flipped ? 7 - dr : dr;
      const rank = 8 - rowIdx;
      const sq = 'abcdefgh'[file] + rank;
      const light = (file + rank) % 2 === 0;
      const p = bd[rowIdx][file];
      let cls = 'sq ' + (light ? 'l' : 'd');
      if (last && (sq === last.from || sq === last.to)) cls += ' hl';
      if (sq === checkSq) cls += ' chk';
      html += '<div class="' + cls + '" data-sq="' + sq + '">';
      if (dc === 0) html += '<span class="co r">' + rank + '</span>';
      if (dr === 7) html += '<span class="co f">' + 'abcdefgh'[file] + '</span>';
      if (p) html += pieceHtml(p.type, p.color);
      html += '</div>';
    }
  }
  boardEl.innerHTML = html;
  sizeBoard();
}

function sizeBoard() {
  const b = $('#board');
  if (b && b.clientWidth) b.style.setProperty('--sq', (b.clientWidth / 8) + 'px');
}

function renderOverlay() {
  const svg = $('#overlay');
  const g = state.game;
  let h = '';
  if (g) {
    // Turn-based best move: for move ply > 0, show best move for that turn (ply - 1).
    const turnIdx = state.ply > 0 ? state.ply - 1 : 0;
    const a = state.analysis[turnIdx];
    if (a && a.best && a.best.length >= 4) {
      h += arrowSvg(a.best.slice(0, 2), a.best.slice(2, 4));
    }
    if (state.ply > 0) {
      const r = state.results[state.ply - 1];
      if (r) {
        const mv = g.moves[state.ply - 1];
        const p = sqXY(mv.to);
        const cl = CLS[r.cls];
        const cx = (p.x + 0.33).toFixed(3);
        const cy = (p.y - 0.33).toFixed(3);
        h += '<circle cx="' + cx + '" cy="' + cy + '" r=".21" fill="' + cl.color + '" stroke="#262421" stroke-width=".03"/>' +
             '<text x="' + cx + '" y="' + cy + '" font-size=".2" font-weight="800" fill="' + cl.fg + '" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif">' + esc(cl.sym) + '</text>';
      }
    }
  }
  svg.innerHTML = h;
}

function renderEval() {
  const a = state.game ? state.analysis[state.ply] : null;
  const bar = $('#evalbar');
  const fill = $('#eval-white');
  const label = $('#eval-label');
  const cp = a ? a.cp : 0;
  const pct = a ? winPct(cp) : 50;
  fill.style.height = pct.toFixed(1) + '%';
  bar.classList.toggle('wb', !state.flipped);
  bar.classList.toggle('wt', state.flipped);
  const atBottom = (cp >= 0) !== state.flipped;
  label.className = 'eval-label ' + (atBottom ? 'lb' : 'lt') + ' ' + (cp >= 0 ? 'onwhite' : 'onblack');
  label.textContent = fmtBarLabel(a);
}

function renderPlayers() {
  const h = state.game ? state.game.headers : {};
  const white = { name: h.White || 'White', elo: h.WhiteElo, c: 'w' };
  const black = { name: h.Black || 'Black', elo: h.BlackElo, c: 'b' };
  const top = state.flipped ? white : black;
  const bottom = state.flipped ? black : white;
  const fill = (sel, p) => {
    $(sel).innerHTML = '<span class="dot ' + p.c + '"></span><span class="pname">' + esc(p.name) + '</span>' +
      (p.elo && p.elo !== '?' ? '<span class="pelo">(' + esc(p.elo) + ')</span>' : '');
  };
  fill('#player-top', top);
  fill('#player-bottom', bottom);
}

function bestSanForPosition(posIndex, uciOverride) {
  const a = state.analysis[posIndex];
  const uci = uciOverride || (a && a.best);
  if (!a || !uci) return null;
  if (!a._sanMap) a._sanMap = {};
  if (a._sanMap[uci] === undefined) {
    const ch = new Chess();
    ch.load(state.game.fens[posIndex]);
    const m = ch.move(uciToMove(uci));
    a._sanMap[uci] = m ? m.san : null;
  }
  return a._sanMap[uci];
}

function summaryHtml() {
  const g = state.game;
  const cols = ['w', 'b'].map((color) => {
    const counts = {};
    let accSum = 0;
    let n = 0;
    g.moves.forEach((m, k) => {
      if (m.color !== color) return;
      const r = state.results[k];
      if (!r) return;
      counts[r.cls] = (counts[r.cls] || 0) + 1;
      accSum += clamp(103.1668 * Math.exp(-0.04354 * r.loss) - 3.1669, 0, 100);
      n++;
    });
    const chips = CLS_ORDER.filter((k) => counts[k]).map((k) =>
      '<span class="sum-chip"><i style="background:' + CLS[k].color + ';color:' + CLS[k].fg + '">' + esc(CLS[k].sym) + '</i>' + counts[k] + '</span>').join('');
    const acc = n ? Math.round(accSum / n) + '%' : '\u2013';
    return '<div class="sum-col"><h3>' + (color === 'w' ? 'White' : 'Black') + '<span>' + acc + '</span></h3><div class="sum-chips">' + chips + '</div></div>';
  });
  return '<div class="summary">' + cols.join('') + '</div>';
}

function renderCard() {
  const el = $('#card');
  const g = state.game;
  if (!g) {
    el.innerHTML = '<div class="empty"><h2>Welcome to ChessLens</h2>' +
      '<p>Import a game from Chess.com or paste a PGN to get engine analysis with plain-English commentary \u2014 all on your device.</p>' +
      '<button class="btn primary" data-open-import>Import a game</button></div>';
    return;
  }
  const total = g.moves.length;
  const done = state.doneCount >= g.fens.length;
  const a = state.analysis[state.ply];
  let html = '';

  if (state.ply === 0) {
    const h = g.headers;
    html += '<div class="card-head"><div class="card-title">' + esc(h.White || 'White') + ' vs ' + esc(h.Black || 'Black') +
      '<small style="color:var(--muted)">' + esc([h.Result && h.Result !== '*' ? h.Result : '', h.Termination || ''].filter(Boolean).join(' \u00B7 ') || (total + ' moves')) + '</small></div>' +
      (a ? '<div class="chip-eval' + (a.cp < 0 ? ' neg' : '') + '">' + esc(fmtEval(a)) + '</div>' : '') + '</div>';
    html += '<p class="card-text">Starting position. Press <b>&gt;</b> to step through the game' +
      (done ? ' \u2014 every move is classified below.' : '; analysis is still running.') + '</p>';
    if (done) html += summaryHtml();

    const startA = state.analysis[0];
    if (startA && startA.best) {
      const san = bestSanForPosition(0, startA.best);
      if (san) html += '<div class="hint"><span class="swatch"></span>White\u2019s best move: <b>' + esc(san) + '</b></div>';
    }
  } else {
    const k = state.ply - 1;
    const mv = g.moves[k];
    const r = state.results[k];
    const moverName = mv.color === 'w' ? 'White' : 'Black';
    const turnBefore = state.analysis[k];

    if (r) {
      const cl = CLS[r.cls];
      html += '<div class="card-head"><div class="badge-lg" style="background:' + cl.color + ';color:' + cl.fg + '">' + esc(cl.sym) + '</div>' +
        '<div class="card-title">' + esc(mv.san) + '<small style="color:' + cl.color + '">' + cl.label + '</small></div>' +
        '<div class="chip-eval' + (state.analysis[state.ply].cp < 0 ? ' neg' : '') + '">' + esc(fmtEval(state.analysis[state.ply])) + '</div></div>';
      html += '<p class="card-text">' + esc(commentFor(k)) + '</p>';
    } else {
      const prev = k > 0 ? g.moves[k - 1] : null;
      html += '<div class="card-head"><div class="card-title">' + esc(mv.san) + '<small style="color:var(--muted)">Move ' + (Math.floor(k / 2) + 1) + (mv.color === 'w' ? '' : '\u2026') + '</small></div></div>';
      html += '<p class="card-text">' + esc(describeMove({ move: mv, prev, color: mv.color })) + '</p>';
      if (!state.engineError) html += '<p class="note" style="color:var(--muted)"><span class="spin"></span>Analyzing this move\u2026</p>';
    }

    if (turnBefore && turnBefore.best) {
      const san = bestSanForPosition(k, turnBefore.best);
      if (san) {
        const label = r && r.isBest
          ? moverName + '\u2019s best move: <b>' + esc(san) + '</b> (played)'
          : moverName + '\u2019s best move here was: <b>' + esc(san) + '</b>';
        html += '<div class="hint"><span class="swatch"></span>' + label + '</div>';
      }
    }
  }

  if (state.engineError) {
    html += '<p class="note">The engine could not be loaded. It downloads once (internet needed) and is then cached for offline use. Reload when you are online to analyze this game.</p>';
  }

  el.innerHTML = html;
}

function buildMoveList() {
  const nav = $('#moves');
  nav.innerHTML = '';
  state.moveEls = [];
  const g = state.game;
  if (!g) return;
  const frag = document.createDocumentFragment();
  g.moves.forEach((m, k) => {
    if (m.color === 'w' || k === 0) {
      const n = document.createElement('span');
      n.className = 'mn';
      n.textContent = (Math.floor(k / 2) + 1) + (m.color === 'w' ? '.' : '\u2026');
      frag.appendChild(n);
    }
    const b = document.createElement('button');
    b.className = 'mv';
    b.dataset.ply = String(k + 1);
    b.innerHTML = '<span class="san">' + esc(m.san) + '</span><i class="tag"></i>';
    frag.appendChild(b);
    state.moveEls[k] = b;
  });
  nav.appendChild(frag);
  nav.scrollLeft = 0;
}

function updateMoveTag(k) {
  const b = state.moveEls[k];
  const r = state.results[k];
  if (!b || !r) return;
  const t = b.querySelector('.tag');
  const cl = CLS[r.cls];
  t.textContent = cl.sym;
  t.style.background = cl.color;
  t.style.color = cl.fg;
  t.classList.add('on');
}

function renderMoveActive() {
  state.moveEls.forEach((b, k) => b.classList.toggle('active', k === state.ply - 1));
  const nav = $('#moves');
  const el = state.moveEls[state.ply - 1];
  if (el) {
    const left = el.offsetLeft - nav.clientWidth / 2 + el.offsetWidth / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  } else {
    nav.scrollTo({ left: 0, behavior: 'smooth' });
  }
}

function renderControls() {
  const total = state.game ? state.game.moves.length : 0;
  $('#btn-first').disabled = state.ply <= 0;
  $('#btn-prev').disabled = state.ply <= 0;
  $('#btn-next').disabled = state.ply >= total;
  $('#btn-last').disabled = state.ply >= total;
}

function render() {
  renderBoard();
  renderOverlay();
  renderEval();
  renderPlayers();
  renderCard();
  renderMoveActive();
  renderControls();
}

function setStatus(text, frac) {
  $('#status').hidden = false;
  $('#status-text').textContent = text;
  const track = $('#status-track');
  const bar = $('#status-bar');
  if (frac == null) {
    track.classList.add('indet');
    bar.style.width = '';
    $('#status-pct').textContent = '';
  } else {
    track.classList.remove('indet');
    bar.style.width = (frac * 100).toFixed(1) + '%';
    $('#status-pct').textContent = Math.round(frac * 100) + '%';
  }
}
function hideStatus() { $('#status').hidden = true; }

function goTo(p) {
  if (!state.game) return;
  const np = clamp(p, 0, state.game.moves.length);
  if (np === state.ply) return;
  state.ply = np;
  render();
}

function loadGame(pgn, opts) {
  opts = opts || {};
  let g;
  try { g = parsePgn(pgn); }
  catch (e) { return { error: e.message }; }
  state.game = g;
  state.ply = 0;
  state.analysis = new Array(g.fens.length).fill(null);
  state.results = new Array(g.fens.length - 1).fill(null);
  state.doneCount = 0;
  state.engineError = false;
  const mc = opts.myColor || detectMyColor(g.headers);
  state.myColor = mc;
  state.flipped = mc === 'b';
  lsSet(LS_PGN, pgn);
  buildMoveList();
  render();
  startAnalysis();
  return { ok: true };
}

async function fetchJson(url) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(navigator.onLine === false ? 'You appear to be offline. Connect to the internet to load Chess.com games.' : 'Could not reach Chess.com. Please try again.'); }
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (!res.ok) throw new Error('Chess.com returned an error (' + res.status + ').');
  return res.json();
}

async function fetchRecentGames(username) {
  const base = 'https://api.chess.com/pub/player/' + encodeURIComponent(username.toLowerCase());
  const data = await fetchJson(base + '/games/archives');
  const archives = data.archives || [];
  if (!archives.length) return [];
  let games = [];
  for (let i = archives.length - 1; i >= Math.max(0, archives.length - 3) && games.length < 15; i--) {
    const month = await fetchJson(archives[i]);
    const list = (month.games || []).filter((x) => x.pgn && (!x.rules || x.rules === 'chess'));
    games = games.concat(list.reverse());
  }
  return games.slice(0, 15);
}

const DRAW_RESULTS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

function fmtTimeControl(g) {
  const tc = String(g.time_control || '');
  if (!tc) return '';
  if (tc.indexOf('/') >= 0) {
    const secs = parseInt(tc.split('/')[1], 10) || 0;
    const days = Math.round(secs / 86400);
    return days + (days === 1 ? ' day' : ' days');
  }
  const parts = tc.split('+');
  const base = parseInt(parts[0], 10) || 0;
  const inc = parts[1] ? parseInt(parts[1], 10) : 0;
  const baseTxt = base >= 60 ? (base % 60 === 0 ? (base / 60) : (base / 60).toFixed(1)) : base + 's';
  return inc ? baseTxt + '+' + inc : (base >= 60 ? baseTxt + ' min' : baseTxt);
}

function renderGameList(games, username) {
  const u = username.toLowerCase();
  const list = $('#glist');
  list.innerHTML = '';
  games.forEach((g, i) => {
    const iAmWhite = (g.white.username || '').toLowerCase() === u;
    const me = iAmWhite ? g.white : g.black;
    const opp = iAmWhite ? g.black : g.white;
    let res = 'draw';
    let word = 'Draw';
    if (me.result === 'win') { res = 'won'; word = 'Won'; }
    else if (DRAW_RESULTS.indexOf(me.result) < 0) { res = 'lost'; word = 'Lost'; }
    const date = g.end_time ? new Date(g.end_time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    const tclass = g.time_class ? cap(g.time_class) : '';
    const btn = document.createElement('button');
    btn.className = 'game';
    btn.dataset.i = String(i);
    btn.innerHTML = '<span class="gcol ' + (iAmWhite ? 'w' : 'b') + '"></span>' +
      '<span class="gmain"><b>' + esc(opp.username || 'Opponent') + ' (' + esc(opp.rating != null ? opp.rating : '?') + ')</b>' +
      '<small>You ' + esc(me.rating != null ? me.rating : '?') + ' \u00B7 ' + esc([tclass, fmtTimeControl(g)].filter(Boolean).join(' ')) + (date ? ' \u00B7 ' + esc(date) : '') + '</small></span>' +
      '<span class="gres ' + res + '">' + word + '</span>';
    list.appendChild(btn);
  });
}

/* ---------- sheets: import + settings ---------- */
function openSheet(tab) {
  $('#sheet').hidden = false;
  $('#in-user').value = state.username || '';
  renderUserChips();
  switchTab(tab || 'user');
  document.body.style.overflow = 'hidden';
  const key = (state.username || '').toLowerCase();
  if (key && state.listUser !== key && state.listLoadingFor !== key) onLoadGames();
}
function openSettings() {
  $('#settings').hidden = false;
  $('#in-profile').value = '';
  setMsg('#profile-msg', '');
  renderProfileList();
  renderAppearance();
  buildPreview();
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#settings').hidden = true;
  document.body.style.overflow = '';
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#tab-user').hidden = name !== 'user';
  $('#tab-pgn').hidden = name !== 'pgn';
}

function setMsg(id, text, isErr) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

async function onLoadGames() {
  const input = $('#in-user');
  const username = input.value.trim().replace(/^@/, '');
  if (!username) { setMsg('#user-msg', 'Enter your Chess.com username.', true); return; }
  const key = username.toLowerCase();
  const req = ++state.listReq;
  state.listLoadingFor = key;
  const btn = $('#btn-load-games');
  btn.disabled = true;
  setMsg('#user-msg', 'Loading games\u2026');
  $('#glist').innerHTML = '';
  try {
    const games = await fetchRecentGames(username);
    if (req !== state.listReq) return;
    const saved = addProfile(username);
    input.value = saved.name || username;
    state.listGames = games;
    state.listUser = key;
    if (!games.length) { setMsg('#user-msg', 'No standard-chess games found for "' + username + '".', true); }
    else {
      setMsg('#user-msg', 'Tap a game to analyze it.');
      renderGameList(games, username);
    }
  } catch (e) {
    if (req !== state.listReq) return;
    setMsg('#user-msg', e.message === 'NOT_FOUND' ? 'User "' + username + '" was not found on Chess.com.' : e.message, true);
  } finally {
    if (req === state.listReq) {
      btn.disabled = false;
      state.listLoadingFor = '';
    }
  }
}

function onPickGame(i) {
  const g = state.listGames[i];
  if (!g) return;
  const u = state.listUser || (state.username || '').toLowerCase();
  const myColor = (g.white.username || '').toLowerCase() === u ? 'w' : 'b';
  const r = loadGame(g.pgn, { myColor });
  if (r.error) { setMsg('#user-msg', r.error, true); return; }
  closeSheet();
}

function onLoadPgn() {
  const text = $('#in-pgn').value;
  const r = loadGame(text, {});
  if (r.error) { setMsg('#pgn-msg', r.error, true); return; }
  setMsg('#pgn-msg', '');
  closeSheet();
}

function onLoadSample() {
  $('#in-pgn').value = SAMPLE_PGN;
  const r = loadGame(SAMPLE_PGN, { myColor: 'w' });
  if (r.error) { setMsg('#pgn-msg', r.error, true); return; }
  setMsg('#pgn-msg', '');
  closeSheet();
}

function onAddProfile() {
  const inp = $('#in-profile');
  const r = addProfile(inp.value);
  if (r.error) { setMsg('#profile-msg', r.error, true); return; }
  inp.value = '';
  setMsg('#profile-msg', r.existed
    ? '"' + r.name + '" was already saved \u2014 now active.'
    : 'Saved "' + r.name + '" and set it as active.');
}

async function waitForChess() {
  for (let i = 0; i < 120; i++) {
    if (typeof Chess === 'function') return true;
    await sleep(100);
  }
  return false;
}

function wireEvents() {
  $('#btn-import').addEventListener('click', () => openSheet('user'));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-flip').addEventListener('click', () => { state.flipped = !state.flipped; render(); });
  $('#btn-first').addEventListener('click', () => goTo(0));
  $('#btn-prev').addEventListener('click', () => goTo(state.ply - 1));
  $('#btn-next').addEventListener('click', () => goTo(state.ply + 1));
  $('#btn-last').addEventListener('click', () => goTo(state.game ? state.game.moves.length : 0));

  $('#moves').addEventListener('click', (e) => {
    const b = e.target.closest('.mv');
    if (b) goTo(parseInt(b.dataset.ply, 10));
  });
  $('#card').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-import]')) openSheet('user');
  });

  /* import sheet */
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#btn-load-games').addEventListener('click', onLoadGames);
  $('#in-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLoadGames(); });
  $('#user-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    setActiveProfile(b.dataset.chip);
    onLoadGames();
  });
  $('#glist').addEventListener('click', (e) => {
    const b = e.target.closest('.game');
    if (b) onPickGame(parseInt(b.dataset.i, 10));
  });
  $('#btn-load-pgn').addEventListener('click', onLoadPgn);
  $('#btn-sample').addEventListener('click', onLoadSample);

  /* settings sheet */
  $('#settings').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const del = e.target.closest('[data-remove-profile]');
    if (del) {
      const n = del.dataset.removeProfile;
      removeProfile(n);
      setMsg('#profile-msg', 'Removed "' + n + '".');
      return;
    }
    const pr = e.target.closest('[data-profile]');
    if (pr) {
      const n = pr.dataset.profile;
      setActiveProfile(n);
      setMsg('#profile-msg', 'Active profile: ' + n + '.');
      return;
    }
    const bt = e.target.closest('[data-board-id]');
    if (bt) { setPref('board', bt.dataset.boardId); return; }
    const pc = e.target.closest('[data-piece-id]');
    if (pc) { setPref('pieces', pc.dataset.pieceId); }
  });
  $('#btn-add-profile').addEventListener('click', onAddProfile);
  $('#in-profile').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAddProfile(); });

  document.addEventListener('keydown', (e) => {
    if (!$('#sheet').hidden || !$('#settings').hidden) { if (e.key === 'Escape') closeSheet(); return; }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') goTo(state.ply - 1);
    else if (e.key === 'ArrowRight') goTo(state.ply + 1);
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(state.game ? state.game.moves.length : 0);
    else if (e.key === 'f') { state.flipped = !state.flipped; render(); }
  });

  if ('ResizeObserver' in window) new ResizeObserver(sizeBoard).observe($('#board-box'));
  window.addEventListener('resize', sizeBoard);

  const net = $('#net');
  const updateNet = () => { net.hidden = navigator.onLine !== false; };
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btn-install').hidden = false;
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (err) { /* ignore */ }
    deferredPrompt = null;
    $('#btn-install').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; });
}

async function boot() {
  lsRemove(LEGACY_CACHE);
  lsRemove(LEGACY_CACHE_V6);
  loadPrefs();
  applyPrefs();
  loadProfiles();
  wireEvents();

  if (!(await waitForChess())) {
    $('#card').innerHTML = '<div class="empty"><h2>Couldn\u2019t load chess.js</h2><p>The chess library is downloaded once and then cached. Connect to the internet and reload the app.</p></div>';
    return;
  }

  const saved = lsGet(LS_PGN) || lsGet(LEGACY_PGN_V6) || lsGet(LEGACY_PGN);
  let restored = false;
  if (saved) restored = !!loadGame(saved, {}).ok;
  lsRemove(LEGACY_PGN_V6);
  lsRemove(LEGACY_PGN);
  lsRemove(LEGACY_USER);
  if (!restored) {
    render();
    openSheet('user');
  }

  setTimeout(() => { if (!restored) engine.init(); }, 1500);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

boot();

})();
