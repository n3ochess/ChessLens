/* ChessLens — local chess analysis (chess.js + Stockfish.js in a Web Worker) */
(function () {
'use strict';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const STD_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const DEPTH = 11;          /* default = Standard preset (kept for fallbacks) */
const MOVETIME_MS = 220;

/* Engine strength presets. "Standard" equals the previous fixed settings, so older
   analyses stay valid. depth/movetime: per position of the game scan; xDepth/xTime:
   single position evaluated in What-if mode. Time caps keep weak phones responsive. */
const ENGINE_LEVELS = [
  { id: 'casual',   name: 'Casual',   desc: 'Fastest \u00B7 depth 8',   depth: 8,  movetime: 120, openTime: 160, xDepth: 12, xTime: 450 },
  { id: 'standard', name: 'Standard', desc: 'Balanced \u00B7 depth 11', depth: 11, movetime: 220, openTime: 280, xDepth: 14, xTime: 700 },
  { id: 'strong',   name: 'Strong',   desc: 'Deeper \u00B7 depth 14',   depth: 14, movetime: 450, openTime: 550, xDepth: 16, xTime: 1200 }
];
const DEFAULT_LEVEL = 'standard';
const LOW_END = (function () {
  try { return (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2; } catch (e) { return false; }
})();
/* Max number of plies (half-moves) that can be labelled "Book". Tweak freely (e.g. 8–16). */
const BOOK_MAX_PLIES = 12;

/* localStorage keys (v10) + legacy keys migrated/cleaned on boot */
const LS_PROFILES = 'chesslens.profiles.v10';
const LS_PREFS = 'chesslens.prefs.v10';
const LS_PGN = 'chesslens.lastpgn.v10';
const LS_CACHE = 'chesslens.cache.v10';
const LS_LIB = 'chesslens.library.v10';
const LEGACY_PROFILES_V9 = 'chesslens.profiles.v9';
const LEGACY_PREFS_V9 = 'chesslens.prefs.v9';
const LEGACY_PGN_V9 = 'chesslens.lastpgn.v9';
const LEGACY_CACHE_V9 = 'chesslens.cache.v9';
const LEGACY_LIB_V9 = 'chesslens.library.v9';
const LEGACY_PROFILES_V8 = 'chesslens.profiles.v8';
const LEGACY_PREFS_V8 = 'chesslens.prefs.v8';
const LEGACY_PGN_V8 = 'chesslens.lastpgn.v8';
const LEGACY_CACHE_V8 = 'chesslens.cache.v8';
const LEGACY_LIB_V8 = 'chesslens.library.v8';
const LEGACY_PROFILES_V7 = 'chesslens.profiles.v7';
const LEGACY_PREFS_V7 = 'chesslens.prefs.v7';
const LEGACY_PGN_V7 = 'chesslens.lastpgn.v7';
const LEGACY_CACHE_V7 = 'chesslens.cache.v7';
const LEGACY_PROFILES = 'chesslens.profiles.v6';
const LEGACY_PREFS = 'chesslens.prefs.v6';
const LEGACY_USER = 'chesslens.username';
const LEGACY_PGN_V6 = 'chesslens.lastpgn.v6';
const LEGACY_PGN = 'chesslens.lastpgn';
const LEGACY_CACHE_V6 = 'chesslens.cache.v6';
const LEGACY_CACHE = 'chesslens.cache.v5';
const CDN_CACHE = 'chesslens-cdn-v10'; // must match sw.js
const MAX_CACHED_GAMES = 10;
const MAX_PROFILES = 20;
const MAX_LIBRARY = 30;
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
  book:       { label: 'Book',       sym: 'B',  color: '#a0784f', fg: '#fff' },
  brilliant:  { label: 'Brilliant',  sym: '!!', color: '#26c2a3', fg: '#fff' },
  great:      { label: 'Great',      sym: '!',  color: '#5c8bb0', fg: '#fff' },
  best:       { label: 'Best',       sym: '\u2605', color: '#81b64c', fg: '#fff' },
  good:       { label: 'Good',       sym: '\u2713', color: '#96af8b', fg: '#fff' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#f7c631', fg: '#262421' },
  mistake:    { label: 'Mistake',    sym: '?',  color: '#e58f2a', fg: '#fff' },
  blunder:    { label: 'Blunder',    sym: '??', color: '#ca3431', fg: '#fff' }
};
const CLS_ORDER = ['book', 'brilliant', 'great', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'];
/* Only "bad-side" classes take part in tactical capping */
const CLS_RANK = { best: 0, good: 1, inaccuracy: 2, mistake: 3, blunder: 4 };

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

/* =====================================================================
   Local opening book (name, SAN moves from the start position).
   Order matters: general names first, specific names later (later wins
   when two lines end on the same position). Every position along a line
   counts as theory; transpositions are matched by position, not by order.
   ===================================================================== */
const OPENING_LINES = [
  /* First moves */
  ['King\u2019s Pawn Game', 'e4'],
  ['Queen\u2019s Pawn Game', 'd4'],
  ['English Opening', 'c4'],
  ['R\u00E9ti Opening', 'Nf3'],
  ['Bird\u2019s Opening', 'f4'],
  ['Nimzowitsch-Larsen Attack', 'b3'],
  ['Indian Defense', 'd4 Nf6'],
  ['Queen\u2019s Pawn Game', 'd4 d5'],

  /* 1.e4 e5 */
  ['King\u2019s Pawn Game', 'e4 e5'],
  ['King\u2019s Knight Opening', 'e4 e5 Nf3'],
  ['Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5'],
  ['Ruy Lopez: Morphy Defense', 'e4 e5 Nf3 Nc6 Bb5 a6'],
  ['Ruy Lopez: Closed', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3'],
  ['Ruy Lopez: Exchange Variation', 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5'],
  ['Ruy Lopez: Berlin Defense', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8'],
  ['Italian Game', 'e4 e5 Nf3 Nc6 Bc4'],
  ['Italian Game: Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O'],
  ['Italian Game: Giuoco Pianissimo', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 c3 d6 O-O a6 Re1 Ba7 Bb3 O-O'],
  ['Italian Game: Evans Gambit', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O Nge7'],
  ['Italian Game: Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2'],
  ['Scotch Game', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6'],
  ['Three Knights Game', 'e4 e5 Nf3 Nc6 Nc3'],
  ['Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6'],
  ['Four Knights Game: Spanish Variation', 'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3 bxc3 Qe7'],
  ['Four Knights Game: Scotch Variation', 'e4 e5 Nf3 Nc6 Nc3 Nf6 d4 exd4 Nxd4 Bb4 Nxc6 bxc6 Bd3 d5 exd5 cxd5'],
  ['Petrov\u2019s Defense', 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7'],
  ['Philidor Defense', 'e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O'],
  ['Latvian Gambit', 'e4 e5 Nf3 f5 Nxe5 Qf6 d4 d6 Nc4 fxe4 Nc3 Qg6'],
  ['Ponziani Opening', 'e4 e5 Nf3 Nc6 c3 Nf6 d4 Nxe4 d5 Ne7 Nxe5 Ng6'],
  ['Vienna Game', 'e4 e5 Nc3'],
  ['Vienna Game: Falkbeer Variation', 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7'],
  ['King\u2019s Gambit', 'e4 e5 f4'],
  ['King\u2019s Gambit Accepted', 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5'],
  ['King\u2019s Gambit Declined', 'e4 e5 f4 Bc5 Nf3 d6 c3 Nf6'],
  ['Bishop\u2019s Opening', 'e4 e5 Bc4 Nf6 d3 c6 Nf3 d5 Bb3 Bd6'],
  ['Danish Gambit', 'e4 e5 d4 exd4 c3 dxc3 Bc4 cxb2 Bxb2 d5 Bxd5 Nf6'],
  ['Center Game', 'e4 e5 d4 exd4 Qxd4 Nc6 Qe3 Nf6 Nc3 Bb4 Bd2 O-O'],

  /* Sicilian */
  ['Sicilian Defense', 'e4 c5'],
  ['Sicilian Defense: Najdorf Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2'],
  ['Sicilian Defense: Dragon Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6'],
  ['Sicilian Defense: Scheveningen Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6 Be2 a6 O-O Qc7 f4 Nc6'],
  ['Sicilian Defense: Classical Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bg5 e6 Qd2 a6 O-O-O Bd7'],
  ['Sicilian Defense: Sveshnikov Variation', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5'],
  ['Sicilian Defense: Taimanov Variation', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6 Qd2 Nf6 O-O-O'],
  ['Sicilian Defense: Kan Variation', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Bc5 Nb3 Ba7 Qe2 Nc6 Nc3 Nge7'],
  ['Sicilian Defense: Alapin Variation', 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 e6 cxd4 d6 Bc4 Nb6'],
  ['Sicilian Defense: Closed', 'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e6'],
  ['Sicilian Defense: Grand Prix Attack', 'e4 c5 Nc3 Nc6 f4 g6 Nf3 Bg7 Bc4 e6 f5'],
  ['Sicilian Defense: Smith-Morra Gambit', 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6 O-O Nf6'],

  /* French */
  ['French Defense', 'e4 e6'],
  ['French Defense: Advance Variation', 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4 Nbd2 Na5'],
  ['French Defense: Winawer Variation', 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 cxd4 Ne2 Nbc6 f4 Bd7'],
  ['French Defense: Classical Variation', 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5'],
  ['French Defense: Tarrasch Variation', 'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6'],
  ['French Defense: Exchange Variation', 'e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O'],

  /* Caro-Kann */
  ['Caro-Kann Defense', 'e4 c6'],
  ['Caro-Kann Defense: Advance Variation', 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nc6 O-O Qb6'],
  ['Caro-Kann Defense: Classical Variation', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bf4 Qa5+'],
  ['Caro-Kann Defense: Exchange Variation', 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7'],
  ['Caro-Kann Defense: Panov Attack', 'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5 Bd3 Nc6'],

  /* Other 1.e4 defenses */
  ['Scandinavian Defense', 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6'],
  ['Scandinavian Defense: Modern Variation', 'e4 d5 exd5 Nf6 d4 Nxd5 Nf3 g6 Be2 Bg7 O-O O-O'],
  ['Pirc Defense', 'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6'],
  ['Pirc Defense: Austrian Attack', 'e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 c5 dxc5 Qa5 Bd3 Qxc5 Qe2 O-O Be3 Qa5 O-O Nc6'],
  ['Modern Defense', 'e4 g6 d4 Bg7 Nc3 d6 Nf3 a6'],
  ['Alekhine\u2019s Defense', 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7 c4 Nb6'],

  /* 1.d4 d5 */
  ['Queen\u2019s Gambit', 'd4 d5 c4'],
  ['Queen\u2019s Gambit Accepted', 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 Qe2 b5 Bb3 Bb7'],
  ['Queen\u2019s Gambit Declined', 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5'],
  ['Queen\u2019s Gambit Declined: Exchange Variation', 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7 Bd3 Nbd7 Qc2 O-O Nge2 Re8'],
  ['Queen\u2019s Gambit Declined: Tarrasch Defense', 'd4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O'],
  ['Albin Countergambit', 'd4 d5 c4 e5 dxe5 d4 Nf3 Nc6 g3 Be6'],
  ['Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O Nbd7'],
  ['Semi-Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 a6 e4 c5'],
  ['London System', 'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O'],
  ['London System', 'd4 Nf6 Nf3 d5 Bf4 e6 e3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O'],
  ['Colle System', 'd4 d5 Nf3 Nf6 e3 e6 Bd3 c5 c3 Nc6 Nbd2 Bd6 O-O O-O'],
  ['Blackmar-Diemer Gambit', 'd4 d5 e4 dxe4 Nc3 Nf6 f3 exf3 Nxf3 e6 Bd3 Bb4'],

  /* 1.d4 Nf6 */
  ['Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7'],
  ['Nimzo-Indian Defense: Classical Variation', 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7 e3 d6 f3 Nbd7'],
  ['Queen\u2019s Indian Defense', 'd4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6 Bc3 d5 Ne5 Nfd7'],
  ['Catalan Opening', 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7'],
  ['Bogo-Indian Defense', 'd4 Nf6 c4 e6 Nf3 Bb4+ Bd2 Qe7 g3 Nc6 Nc3 Bxc3 Bxc3 Ne4 Rc1 O-O'],
  ['King\u2019s Indian Defense', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7'],
  ['King\u2019s Indian Defense: Samisch Variation', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5 d5 Nh5'],
  ['King\u2019s Indian Defense: Four Pawns Attack', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6'],
  ['Gr\u00FCnfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3 Qa5 Qd2 Nc6 Rc1 O-O'],
  ['Gr\u00FCnfeld Defense: Russian Variation', 'd4 Nf6 c4 g6 Nc3 d5 Nf3 Bg7 Qb3 dxc4 Qxc4 O-O e4 Bg4 Be3 Nfd7'],
  ['Benoni Defense', 'd4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7 Be2 O-O O-O'],
  ['Benko Gambit', 'd4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 Bxa6 Nc3 d6 e4 Bxf1 Kxf1 g6'],
  ['Budapest Gambit', 'd4 Nf6 c4 e5 dxe5 Ng4 Bf4 Nc6 Nf3 Bb4+ Nbd2 Qe7 a3 Ngxe5 axb4 Nxf3+ Nxf3 Qxb4+'],
  ['Old Indian Defense', 'd4 Nf6 c4 d6 Nc3 Nbd7 e4 e5 Nf3 Be7 Be2 O-O O-O c6'],
  ['Trompowsky Attack', 'd4 Nf6 Bg5 Ne4 Bf4 c5 f3 Qa5+ c3 Nf6 d5 Qb6'],
  ['Torre Attack', 'd4 Nf6 Nf3 e6 Bg5 c5 e3 h6 Bh4 cxd4 exd4 Qb6'],

  /* Dutch */
  ['Dutch Defense', 'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6'],
  ['Dutch Defense: Stonewall Variation', 'd4 f5 c4 Nf6 g3 e6 Bg2 Be7 Nf3 O-O O-O d5 b3 c6'],

  /* Flank openings */
  ['R\u00E9ti Opening', 'Nf3 d5 c4 e6 g3 Nf6 Bg2 Be7 O-O O-O b3 c5'],
  ['Zukertort Opening', 'Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5'],
  ['English Opening: Symmetrical Variation', 'c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 e6 O-O Nge7 d3 O-O'],
  ['English Opening: Reversed Sicilian', 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7'],
  ['Bird\u2019s Opening', 'f4 d5 Nf3 Nf6 e3 g6 Be2 Bg7 O-O O-O d3 c5'],
  ['Nimzowitsch-Larsen Attack', 'b3 e5 Bb2 Nc6 e3 d5 Bb5 Bd6 Bxc6+ bxc6 Ne2 Ne7']
];

/* ---------- opening book engine ---------- */
let BOOK = null;

function posKey(fen) {
  return fen.split(' ').slice(0, 3).join(' ');
}

function ensureBook() {
  if (BOOK) return BOOK;
  const keys = new Set();
  const names = new Map();
  OPENING_LINES.forEach((line) => {
    const name = line[0];
    const toks = line[1].split(/\s+/).filter(Boolean);
    const ch = new Chess();
    keys.add(posKey(ch.fen()));
    let ok = true;
    for (let i = 0; i < toks.length; i++) {
      let m = null;
      try { m = ch.move(toks[i], { sloppy: true }); } catch (e) { m = null; }
      if (!m) { ok = false; console.warn('[ChessLens] book line skipped at', name, toks[i]); break; }
      keys.add(posKey(ch.fen()));
    }
    if (ok) names.set(posKey(ch.fen()), name);
  });
  BOOK = { keys, names };
  return BOOK;
}

/* Returns { count, names[k], opening } where moves 0..count-1 are theory. */
function computeBook(fens, nMoves) {
  const out = { count: 0, names: [], opening: null };
  try {
    if (!fens || !fens.length || fens[0].split(' ')[0] !== STD_PLACEMENT || fens[0].split(' ')[1] !== 'w') return out;
    const bk = ensureBook();
    let cur = null;
    const lim = Math.min(nMoves, BOOK_MAX_PLIES);
    for (let k = 0; k < lim; k++) {
      const key = posKey(fens[k + 1]);
      if (!bk.keys.has(key)) break;
      if (bk.names.has(key)) cur = bk.names.get(key);
      out.names[k] = cur;
      out.count = k + 1;
    }
    out.opening = out.count ? cur : null;
  } catch (e) {
    console.warn('[ChessLens] book detection failed', e);
    return { count: 0, names: [], opening: null };
  }
  return out;
}

/* =====================================================================
   Openings (Learn > Openings): idea, typical threats and several lines.
   Variant notes ('n') are keyed by 0-based ply and only needed after the
   line leaves the main line; earlier plies reuse the main-line notes.
   ===================================================================== */
const OPENINGS = [
 {
  "id": "italian",
  "name": "Italian Game",
  "side": "w",
  "blurb": "White develops fast and aims the bishop at f7. A friendly first opening with clear plans.",
  "moves": "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O",
  "notes": [
   "White claims the center and opens lines for the queen and the f1-bishop.",
   "Black mirrors the idea: a pawn in the center and open lines for the queen and the f8-bishop.",
   "The knight develops, attacks the e5 pawn and gets White ready to castle.",
   "Black defends e5 and develops a piece at the same time.",
   "The Italian bishop eyes f7, Black's most sensitive square early in the game.",
   "Black develops the bishop to the matching diagonal. This is the Giuoco Piano, the \"quiet game\".",
   "Prepares d4 to build a big pawn center and gives the bishop a retreat square on b3.",
   "Black develops and puts pressure on the e4 pawn.",
   "A solid choice: d3 supports e4 and keeps the position flexible instead of forcing matters.",
   "Black supports the e5 pawn and frees the c8-bishop.",
   "White castles: the king is safe and the rook joins the game.",
   "Black does the same. Both sides are developed and the middlegame plans begin (Re1, Nbd2, a later d4 or b4)."
  ],
  "idea": "Develop fast, castle, and build a strong center with c3 and d3 (or d4) while the bishop on c4 eyes f7. It is a game about piece activity and a steady plan, not about an early attack.",
  "threats": [
   "The f7 square: with the c4 bishop and a knight on g5, f7 is only defended by the king until Black castles.",
   "Nxf7 sacrifices (the \"Fried Liver\" idea in the Two Knights) punish a Black player who forgets about f7.",
   "The d4 break: if Black is slow, d4 opens the center for White's better-developed pieces.",
   "Black's counter: a well-timed ...d5 frees the position, and ...Nxe4 tricks work if e4 is left loose."
  ],
  "variants": [
   {
    "name": "Evans Gambit",
    "note": "White sacrifices the b-pawn for time and a big center.",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O Nge7",
    "n": {
     "6": "The Evans Gambit: White offers the b-pawn to gain time and build a strong center with c3 and d4.",
     "7": "Black accepts the pawn and pulls the bishop away from the center.",
     "8": "White attacks the bishop and prepares d4.",
     "9": "The bishop retreats but keeps an eye on the e1\u2013a5 diagonal and the c3 pawn.",
     "10": "White takes the center and opens lines for the pieces.",
     "11": "Black grabs a second pawn.",
     "12": "White is a pawn down but far ahead in development. That is the whole point of the gambit.",
     "13": "Black develops and prepares to defend. The position is sharp and rich in tactics."
    }
   },
   {
    "name": "Two Knights Defense",
    "note": "Black counterattacks e4 instead of copying White's bishop.",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2",
    "n": {
     "5": "The Two Knights Defense: Black counterattacks e4 rather than mirroring the bishop.",
     "6": "The sharp Knight Attack: the knight and bishop both aim at f7.",
     "7": "Black's key reply: strike back in the center right away.",
     "8": "White takes the pawn.",
     "9": "Black attacks the bishop and aims to win the d5 pawn back later.",
     "10": "The bishop retreats with check.",
     "11": "Black blocks the check and attacks the bishop.",
     "12": "White grabs a pawn.",
     "13": "Black recaptures and hits the bishop again.",
     "14": "The bishop retreats. White has an extra pawn, Black has activity and development in return."
    }
   }
  ]
 },
 {
  "id": "ruy",
  "name": "Ruy Lopez",
  "side": "w",
  "blurb": "The Spanish Game: slow, lasting pressure on e5 through the c6-knight. Rich and strategic.",
  "moves": "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3",
  "notes": [
   "White grabs the center and opens lines for the queen and the f1-bishop.",
   "Black mirrors with a center pawn of their own.",
   "The knight attacks e5 and develops toward castling.",
   "Black defends the pawn and develops.",
   "The Ruy Lopez: the bishop pressures the knight that guards e5. It is not winning a pawn yet, just building long-term pressure.",
   "The Morphy Defense: Black asks the bishop what it wants to do.",
   "White keeps the bishop on the diagonal. Taking on c6 would be the Exchange Variation, a different plan.",
   "Black develops and attacks the e4 pawn.",
   "White castles first and lets e4 go for now. Taking it would lead to the sharp Open Variation.",
   "Black picks the solid Closed Spanish: e5 is protected and the king is ready to castle.",
   "The rook defends e4, so the bishop can retreat without losing the pawn.",
   "Black gains space on the queenside and asks the bishop to move again.",
   "The bishop retreats to the long diagonal where it keeps eyeing f7.",
   "Black solidly supports e5 and opens the c8-bishop.",
   "Prepares the central break d4 and makes room for the bishop on c2.",
   "Black castles; both sides have finished their development.",
   "A useful waiting move: it stops ...Bg4 and gives the king some air. This is the main-line Closed Ruy Lopez."
  ],
  "idea": "Pressure the knight that defends e5, keep long-term tension in the center, and slowly build up with c3 and d4. The plan is strategic: space, a flexible center and pressure on the e-file.",
  "threats": [
   "Bxc6 followed by Nxe5 looks like winning a pawn, but ...Qd4 forks the knight and e4, so e5 is \"poisoned\".",
   "If Black removes the defender of e5 or weakens the king's side, the pin on c6 becomes a real threat.",
   "The d4 break once c3 is in: it opens the center when White's pieces are ready.",
   "Black's counterplay: ...Nxe4 ideas in the Open lines, and ...b5 gaining space while the bishop retreats."
  ],
  "variants": [
   {
    "name": "Exchange Variation",
    "note": "White trades the bishop for the knight to damage Black's pawns.",
    "moves": "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5",
    "n": {
     "6": "The Exchange Variation: White gives up the bishop pair to wreck Black's pawn structure.",
     "7": "Black recaptures. The doubled c-pawns are a weakness, but Black gets the bishop pair.",
     "8": "White castles. Taking on e5 right now would run into ...Qd4, so the pawn is indirectly protected.",
     "9": "Black supports e5 solidly.",
     "10": "White opens the center, aiming at Black's weakened queenside pawns.",
     "11": "Black takes the pawn.",
     "12": "White recaptures. The plan is to trade pieces and win the endgame with the healthier kingside majority.",
     "13": "Black kicks the knight and activates the bishops."
    }
   },
   {
    "name": "Berlin Defense",
    "note": "Black counterattacks e4 at once. Solid and famously hard to beat.",
    "moves": "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8",
    "n": {
     "5": "The Berlin Defense: Black counterattacks e4 right away. Solid and famously hard to crack.",
     "6": "White castles and lets e4 go for the moment.",
     "7": "Black takes the pawn.",
     "8": "White strikes in the center to open lines.",
     "9": "The knight retreats and attacks the bishop.",
     "10": "White trades the bishop for the knight.",
     "11": "Black recaptures.",
     "12": "White regains the pawn and attacks the knight.",
     "13": "The knight steps away.",
     "14": "White trades queens, heading for the famous Berlin endgame.",
     "15": "Black's king is stuck in the center but very safe. The structure is rock-solid, the \"Berlin Wall\"."
    }
   }
  ]
 },
 {
  "id": "caro",
  "name": "Caro-Kann Defense",
  "side": "b",
  "blurb": "A rock-solid answer to 1.e4 that keeps a healthy pawn structure and a free light-squared bishop.",
  "moves": "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7",
  "notes": [
   "White takes the center with the king's pawn.",
   "The Caro-Kann: Black prepares ...d5 with a pawn on c6, so the c8-bishop is not locked in (unlike the French).",
   "White builds a big pawn center.",
   "Black challenges the e4 pawn right away.",
   "White defends e4 with a knight.",
   "Black trades the center pawn and opens the position.",
   "White recaptures and leads in development.",
   "The key Caro-Kann idea: bring the bishop out before closing the pawn chain with ...e6.",
   "The knight attacks the bishop with tempo.",
   "The bishop stays active on the diagonal and is safe behind the pawn chain.",
   "White threatens h5 to harass the bishop.",
   "Black stops Ng5 and prepares a retreat square on h7.",
   "White develops the last minor piece toward the center.",
   "Black develops and supports ...Ngf6. The structure is healthy and there are no weaknesses to attack."
  ],
  "idea": "Black prepares ...d5 with a solid pawn on c6, keeping a healthy structure and a free light-squared bishop. The goal is safety first and counterplay later.",
  "threats": [
   "After exd5 cxd5, White's Qb3 hits d5 and b7 at the same time.",
   "In the Classical line, h4\u2013h5 harasses the bishop, so Black must keep it safe on g6 or h7.",
   "Do not lock the bishop in with ...e6 before developing it: that is the typical French problem.",
   "In the Advance Variation Black attacks the base of the chain with ...c5 and ...Qb6."
  ],
  "variants": [
   {
    "name": "Advance Variation",
    "note": "White gains space with e5; Black hits the pawn chain.",
    "moves": "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nc6 O-O Qb6",
    "n": {
     "4": "The Advance Variation: White gains space and fixes the pawn chain.",
     "5": "Black develops the bishop BEFORE playing ...e6. That is the Caro-Kann trump.",
     "6": "White develops the knight.",
     "7": "Now the bishop is outside the pawn chain and safe.",
     "8": "White prepares to castle.",
     "9": "Black attacks the base of White's pawn chain, d4.",
     "10": "White defends d4.",
     "11": "Black adds more pressure on d4.",
     "12": "White castles.",
     "13": "Black pressures d4 and b2. The play is balanced and typical for this line."
    }
   },
   {
    "name": "Exchange Variation",
    "note": "White simplifies into a symmetrical structure.",
    "moves": "e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7",
    "n": {
     "4": "The Exchange Variation: White simplifies and gets a symmetrical pawn structure.",
     "5": "Black recaptures and the c-file opens.",
     "6": "White develops and eyes the kingside.",
     "7": "Black develops the knight.",
     "8": "White solidifies the d4 pawn.",
     "9": "Black develops and adds pressure on d5.",
     "10": "White develops the bishop outside the pawn chain.",
     "11": "Black does the same idea and pins the f3 knight.",
     "12": "White hits d5 and b7 at once.",
     "13": "Black protects b7 and keeps everything together."
    }
   }
  ]
 },
 {
  "id": "fourknights",
  "name": "Four Knights Game",
  "side": "w",
  "blurb": "Symmetrical development with a pin on the knights. Simple, solid and great for beginners.",
  "moves": "e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3 bxc3 Qe7",
  "notes": [
   "White grabs the center and opens lines for the queen and the f1-bishop.",
   "Black mirrors with a center pawn of their own.",
   "The knight attacks e5 and develops toward castling.",
   "Black defends e5 and develops.",
   "The second knight protects e4 and heads the Four Knights setup.",
   "Black copies the development, and all four knights are now out.",
   "The Spanish Variation: the bishop pins the c6-knight, which guards e5.",
   "Black mirrors the pin against the c3-knight.",
   "White castles and puts the king in safety.",
   "Black does the same.",
   "A solid move: d3 supports e4 and opens the c1-bishop.",
   "Black supports e5 and opens the c8-bishop.",
   "The bishop pins the f6-knight against the queen, adding pressure.",
   "Black trades the bishop for the knight, giving White doubled pawns.",
   "White recaptures. The doubled c-pawns come with an open b-file and strong central control.",
   "Black sidesteps the pin on the queen. The position is balanced and still very symmetrical."
  ],
  "idea": "Develop all four knights, protect e4 and e5, and play simply: castle, d3, Bg5 or Bb5. The goal is a safe, symmetrical position with easy plans.",
  "threats": [
   "Pin ideas: Bb5 against ...Bb4, and Bg5 pinning the f6 knight.",
   "Nxe5 tricks when the c6 knight is pinned and e5 loses protection.",
   "In the Scotch line d4 opens the center at once, so check for Nxe5 and ...Bxc3 tactics.",
   "After ...Bxc3, doubled pawns give White the bishop pair and open files."
  ],
  "variants": [
   {
    "name": "Scotch Four Knights",
    "note": "White opens the center right away with d4.",
    "moves": "e4 e5 Nf3 Nc6 Nc3 Nf6 d4 exd4 Nxd4 Bb4 Nxc6 bxc6 Bd3 d5 exd5 cxd5",
    "n": {
     "6": "The Scotch Four Knights: White opens the center at once.",
     "7": "Black takes the pawn.",
     "8": "White recaptures and centralizes the knight.",
     "9": "Black pins the c3 knight.",
     "10": "White trades the knight to damage Black's pawns.",
     "11": "Black recaptures.",
     "12": "White develops the bishop.",
     "13": "Black grabs the center.",
     "14": "White takes the pawn.",
     "15": "Black recaptures. The position is open and balanced, with active pieces on both sides."
    }
   }
  ]
 }
];

/* =====================================================================
   Interactive lessons (Learn > Lessons). Positions and solutions were
   verified with a legal-move checker. accept = allowed first moves (uci).
   ===================================================================== */
const DRILLS = [
 {
  "id": "castling",
  "name": "Castling",
  "blurb": "Tuck the king away and bring a rook into play in one move.",
  "goal": "Castling moves the king two squares toward a rook, and the rook jumps over it. It only works if neither piece has moved, the squares between are empty, and the king is not in check or passing through an attacked square.",
  "steps": [
   {
    "fen": "r3k2r/pppq1ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 8",
    "task": "Castle kingside (short): move the king two squares toward the h1 rook.",
    "accept": [
     "e1g1"
    ],
    "hint": "Drag the king from e1 to g1 \u2014 the rook will jump to f1 by itself.",
    "ok": "Castled! The king is tucked behind its pawns and the h1 rook now sits on f1, ready for action.",
    "wrong": {
     "e1f1": "The king only stepped one square. Castling is a two-square king move: go to g1.",
     "h1f1": "Moving the rook alone is not castling. Move the king two squares and the rook follows."
    }
   },
   {
    "fen": "r3kb1r/ppp2ppp/2n1bn2/3pp3/3PP3/2N1BN2/PPPQ1PPP/R3KB1R w KQkq - 0 8",
    "task": "The f1 bishop is still at home, so short castling is not possible. Castle queenside (long).",
    "accept": [
     "e1c1"
    ],
    "hint": "Drag the king from e1 to c1 \u2014 the a1 rook jumps to d1.",
    "ok": "Long castling: the king goes to c1 and the rook to d1. All the squares between king and rook had to be empty.",
    "wrong": {
     "e1d1": "One step is not castling. For long castling the king travels two squares to c1."
    }
   },
   {
    "fen": "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 5",
    "task": "You play Black. Castle kingside to get your king to safety.",
    "accept": [
     "e8g8"
    ],
    "hint": "Drag the king from e8 to g8.",
    "ok": "Black castles too: the king goes to g8 and the rook to f8. The same rules apply to both colors.",
    "wrong": {
     "e8f8": "Only one square. Castling needs the king to jump two squares: g8.",
     "h8f8": "The rook cannot castle by itself. Move the king two squares."
    }
   }
  ]
 },
 {
  "id": "enpassant",
  "name": "En Passant",
  "blurb": "A special pawn capture that is only available for one move.",
  "goal": "If an enemy pawn jumps two squares and lands right beside your pawn, you may capture it as if it had moved only one square. You must do it immediately, or the chance is gone.",
  "steps": [
   {
    "fen": "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
    "task": "Black just played ...d5, jumping two squares right next to your e5 pawn. Capture it en passant.",
    "accept": [
     "e5d6"
    ],
    "hint": "Move the e5 pawn diagonally to d6, the square the black pawn jumped over.",
    "ok": "Exd6 en passant! Your pawn lands on d6 and the black pawn on d5 is removed, as if it had only moved one square.",
    "wrong": {
     "e5e6": "Pushing is legal, but you can capture the d5 pawn \u201cin passing\u201d right now. Move diagonally to d6."
    }
   },
   {
    "fen": "rnbqkbnr/pppp1ppp/8/8/3Pp3/5N2/PPP1PPPP/RNBQKB1R b KQkq d3 0 3",
    "task": "You play Black. White just pushed d2\u2013d4 beside your e4 pawn. Capture en passant.",
    "accept": [
     "e4d3"
    ],
    "hint": "Move the e4 pawn diagonally to d3.",
    "ok": "Exd3 en passant! It works for Black too, and only on the very next move after the double step.",
    "wrong": {
     "e4e3": "Advancing is legal, but the en passant chance would be gone next move. Capture on d3 now."
    }
   }
  ]
 },
 {
  "id": "pin",
  "name": "Pin",
  "blurb": "Freeze a piece because moving it would expose something more valuable.",
  "goal": "A pin attacks a piece that cannot (or should not) move because a more valuable piece stands behind it on the same line. Bishops, rooks and queens create pins.",
  "steps": [
   {
    "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 0 4",
    "task": "Pin the knight on f6 to the black queen.",
    "accept": [
     "c1g5"
    ],
    "hint": "Develop the c1 bishop to g5: the knight on f6 is in front of the queen on d8.",
    "ok": "Bg5 pins the knight to the queen. If it moves, Bxd8 wins the queen \u2014 that is a relative pin.",
    "wrong": {
     "c1e3": "A fine developing move, but it pins nothing. Aim at the f6 knight with the queen behind it."
    }
   },
   {
    "fen": "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq - 2 4",
    "task": "You play Black. Pin the white knight on c3 to the king.",
    "accept": [
     "f8b4"
    ],
    "hint": "The f8 bishop can go to b4: the c3 knight stands between it and the king on e1.",
    "ok": "Bb4 pins the knight to the king. It cannot legally move at all \u2014 that is an absolute pin (the Nimzo-Indian idea).",
    "wrong": {
     "f8e7": "Solid, but it pins nothing. Look for a diagonal that points at the king through the c3 knight."
    }
   },
   {
    "fen": "4k3/4n3/8/8/8/8/7R/4K3 w - - 0 1",
    "task": "Pin the black knight on e7 to its king using your rook.",
    "accept": [
     "h2e2"
    ],
    "hint": "Put the rook on the e-file: Re2.",
    "ok": "Re2 pins the knight to the king along the e-file. It is frozen, and you can now pile up more pressure on it.",
    "wrong": {
     "h2h7": "The rook now attacks the knight along the 7th rank, but the king is not behind it, so it is not a pin."
    }
   }
  ]
 },
 {
  "id": "skewer",
  "name": "Skewer",
  "blurb": "Attack a valuable piece so it must move, and win what stands behind it.",
  "goal": "A skewer is the reverse of a pin: you attack a valuable piece (often the king) on a line, it has to step aside, and you capture the less valuable piece behind it.",
  "steps": [
   {
    "fen": "1r2k3/8/8/8/8/8/7R/4K3 w - - 0 1",
    "task": "Give a check that skewers the king and wins the rook on b8.",
    "accept": [
     "h2h8"
    ],
    "hint": "Play Rh8+: the king on e8 is in front of the rook on b8 along the 8th rank.",
    "ok": "Rh8+ \u2014 the king must leave the 8th rank, and then Rxb8 wins the rook. That is a skewer.",
    "wrong": {
     "h2e2": "That is a check, but nothing stands behind the king on the e-file. A skewer needs a piece to win behind it."
    }
   },
   {
    "fen": "7r/6k1/8/8/8/8/8/2B3K1 w - - 0 1",
    "task": "Skewer the king and the rook on h8 with your bishop.",
    "accept": [
     "c1b2"
    ],
    "hint": "Bb2+ checks along the long diagonal; the rook on h8 is behind the king.",
    "ok": "Bb2+! The king has to move, and then the bishop takes the rook on h8. Attack from far away so the king cannot just capture you.",
    "wrong": {
     "c1h6": "The king simply captures the bishop on h6. Use the long diagonal from a distance."
    }
   },
   {
    "fen": "3r4/8/8/3k4/8/8/8/R3K3 w - - 0 1",
    "task": "Win the black rook with a skewer along the d-file.",
    "accept": [
     "a1d1"
    ],
    "hint": "Play Rd1+: the king on d5 is in front of the rook on d8.",
    "ok": "Rd1+ and the king has to move off the d-file, so Rxd8 follows. The king was the front piece of the skewer.",
    "wrong": {
     "a1a5": "That is a check, but nothing is behind the king on the 5th rank. Find the line with a rook behind the king."
    }
   }
  ]
 },
 {
  "id": "mates",
  "name": "Checkmate Patterns",
  "blurb": "Five classic ways to finish the game.",
  "goal": "Checkmate means the king is attacked and cannot escape, block or capture. Learning a few patterns helps you spot mates in real games.",
  "steps": [
   {
    "fen": "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1",
    "name": "Back-rank mate",
    "task": "Back-rank mate: the black king is boxed in by its own pawns. Deliver checkmate.",
    "accept": [
     "a1a8"
    ],
    "hint": "Move the rook to the 8th rank.",
    "ok": "Ra8#! The king cannot step forward because its own pawns block it \u2014 the classic back-rank mate.",
    "wrong": {}
   },
   {
    "fen": "7k/R7/8/8/8/8/1R6/4K3 w - - 0 1",
    "name": "Ladder mate",
    "task": "Ladder mate: use your two rooks to checkmate.",
    "accept": [
     "b2b8"
    ],
    "hint": "One rook controls the 7th rank; bring the other to the 8th.",
    "ok": "Rb8#! The rooks work like a ladder: one covers the 7th rank, the other gives check on the 8th.",
    "wrong": {
     "a7h7": "Check, but the king simply captures the undefended rook on h7."
    }
   },
   {
    "fen": "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1",
    "name": "Queen and king",
    "task": "Queen and king: checkmate in one move. The queen must be protected by your king.",
    "accept": [
     "g6g7",
     "g6g8",
     "g6h5",
     "g6h6"
    ],
    "hint": "Give check on a square the king cannot capture, such as g7.",
    "ok": "Checkmate! The queen is protected by the king and every escape square is covered.",
    "wrong": {
     "g6h7": "Check, but the king can capture on h7: nothing protects the queen there."
    }
   },
   {
    "fen": "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
    "name": "Smothered mate",
    "task": "Smothered mate: the king is surrounded by its own pieces. Find the knight move that mates.",
    "accept": [
     "g5f7"
    ],
    "hint": "The knight jumps to f7, attacking h8.",
    "ok": "Nf7#! The king is smothered by its own rook and pawns, and a knight check cannot be blocked.",
    "wrong": {}
   },
   {
    "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    "name": "Scholar's mate",
    "task": "Scholar's mate: the queen and bishop aim at f7. Finish the game.",
    "accept": [
     "h5f7"
    ],
    "hint": "Take on f7 with the queen, protected by the c4 bishop.",
    "ok": "Qxf7#! The pawn on f7 was only defended by the king, and the bishop protects the queen. Defend f7 early!",
    "wrong": {
     "h5h7": "Taking h7 is not check and leaves your queen loose. Look for the weak f7 square."
    }
   }
  ]
 }
];

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
  library: [],
  repSel: null,
  prefs: { board: 'green', pieces: 'neo', engine: DEFAULT_LEVEL, sound: true, botColor: 'w', botLevel: 'easy', done: {} },
  learnSub: 'openings',
  learnOpening: null,
  analysisDepth: DEPTH,
  explore: null,
  exploreReq: 0,
  lesson: null,
  sel: null,
  drag: null,
  promo: null,
  anim: null
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
   Preferences (board theme + piece style) — Neo is the default
   ===================================================================== */
function loadPrefs() {
  let raw = null;
  try {
    raw = lsGet(LS_PREFS) || lsGet(LEGACY_PREFS_V9) || lsGet(LEGACY_PREFS_V8) || lsGet(LEGACY_PREFS_V7) || lsGet(LEGACY_PREFS);
    const o = JSON.parse(raw || '{}');
    if (o && BOARD_THEMES.some((t) => t.id === o.board)) state.prefs.board = o.board;
    if (o && PIECE_STYLES.some((s) => s.id === o.pieces)) state.prefs.pieces = o.pieces;
    if (o && ENGINE_LEVELS.some((l) => l.id === o.engine)) state.prefs.engine = o.engine;
    if (o && typeof o.sound === 'boolean') state.prefs.sound = o.sound;
    if (o && (o.botColor === 'w' || o.botColor === 'b' || o.botColor === 'r')) state.prefs.botColor = o.botColor;
    if (o && /^[a-z]{3,12}$/.test(o.botLevel || '')) state.prefs.botLevel = o.botLevel;
    if (o && o.done && typeof o.done === 'object') {
      Object.keys(o.done).forEach((k) => { if (/^[a-z]{2,20}$/.test(k) && o.done[k] === true) state.prefs.done[k] = true; });
    }
  } catch (e) { /* ignore */ }
  /* first run on modest hardware: start with the lightest preset */
  if (!raw && LOW_END) state.prefs.engine = 'casual';
  if (lsGet(LS_PREFS) === null) lsSet(LS_PREFS, JSON.stringify(state.prefs));
}
function applyPrefs() {
  const root = document.documentElement;
  root.setAttribute('data-board', state.prefs.board);
  root.setAttribute('data-pieces', state.prefs.pieces);
}
function setPref(key, val) {
  state.prefs[key] = val;
  savePrefs();
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
  const raw = lsGet(LS_PROFILES) || lsGet(LEGACY_PROFILES_V9) || lsGet(LEGACY_PROFILES_V8) || lsGet(LEGACY_PROFILES_V7) || lsGet(LEGACY_PROFILES);
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
  if (lsGet(LS_PROFILES) === null) saveProfiles();
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
    renderGamesTab();
    setUserMsg('');
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

  const eo = $('#engine-levels');
  if (eo) {
    eo.innerHTML = ENGINE_LEVELS.map((l) =>
      '<button class="opt" data-engine-id="' + l.id + '" aria-pressed="' + (state.prefs.engine === l.id) + '">' +
      '<span>' + esc(l.name) + '</span><small>' + esc(l.desc) + '</small></button>'
    ).join('');
  }
  const eh = $('#engine-hint');
  if (eh) eh.hidden = !LOW_END;
  const so = $('#sound-opts');
  if (so) {
    so.innerHTML = [{ id: 'on', name: 'On' }, { id: 'off', name: 'Off' }].map((o) =>
      '<button class="opt" data-sound-id="' + o.id + '" aria-pressed="' + ((o.id === 'on') === !!state.prefs.sound) + '">' +
      '<span>' + esc(o.name) + '</span></button>'
    ).join('');
  }
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
  const book = computeBook(fens, moves.length);
  return { headers, startFen, moves, fens, book, key: hashStr(fens.join('|')) };
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

/* Analysis cache entries are keyed per game AND per engine strength ("<key>:<level>").
   Everything stored before v9 was produced with the fixed Standard settings. */
function migrateCacheObj(raw) {
  const o = JSON.parse(raw);
  if (!o || !o.data || typeof o.data !== 'object') return null;
  const tag = (k) => (k.indexOf(':') >= 0 ? k : k + ':standard');
  const out = { order: [], data: {} };
  Object.keys(o.data).forEach((k) => { if (o.data[k]) out.data[tag(k)] = o.data[k]; });
  (Array.isArray(o.order) ? o.order : []).forEach((k) => {
    const nk = tag(String(k));
    if (out.data[nk] && out.order.indexOf(nk) < 0) out.order.push(nk);
  });
  Object.keys(out.data).forEach((k) => { if (out.order.indexOf(k) < 0) out.order.push(k); });
  return out;
}

/* One-time, safe migration of v8 (and older) data to v9 keys, then cleanup of old keys */
function migrateStorage() {
  try {
    if (lsGet(LS_CACHE) === null) {
      const v9 = lsGet(LEGACY_CACHE_V9);
      if (v9) {
        lsSet(LS_CACHE, v9);
      } else {
        const old = lsGet(LEGACY_CACHE_V8) || lsGet(LEGACY_CACHE_V7);
        if (old) {
          const m = migrateCacheObj(old);
          if (m) lsSet(LS_CACHE, JSON.stringify(m));
        }
      }
    }
  } catch (e) { /* ignore */ }
  try {
    if (lsGet(LS_LIB) === null) {
      const oldLib = lsGet(LEGACY_LIB_V9) || lsGet(LEGACY_LIB_V8);
      if (oldLib) lsSet(LS_LIB, oldLib);
    }
  } catch (e) { /* ignore */ }
  lsRemove(LEGACY_CACHE_V9);
  lsRemove(LEGACY_CACHE_V8);
  lsRemove(LEGACY_CACHE_V7);
  lsRemove(LEGACY_CACHE_V6);
  lsRemove(LEGACY_CACHE);
}
function cleanupLegacyStorage() {
  if (lsGet(LS_PREFS) !== null) { lsRemove(LEGACY_PREFS_V9); lsRemove(LEGACY_PREFS_V8); lsRemove(LEGACY_PREFS_V7); lsRemove(LEGACY_PREFS); }
  if (lsGet(LS_PROFILES) !== null) { lsRemove(LEGACY_PROFILES_V9); lsRemove(LEGACY_PROFILES_V8); lsRemove(LEGACY_PROFILES_V7); lsRemove(LEGACY_PROFILES); lsRemove(LEGACY_USER); }
  if (lsGet(LS_PGN) !== null) { lsRemove(LEGACY_PGN_V9); lsRemove(LEGACY_PGN_V8); lsRemove(LEGACY_PGN_V7); lsRemove(LEGACY_PGN_V6); lsRemove(LEGACY_PGN); }
  if (lsGet(LS_LIB) !== null) { lsRemove(LEGACY_LIB_V9); lsRemove(LEGACY_LIB_V8); }
}

/* =====================================================================
   Game library (games imported / opened on this device)
   ===================================================================== */
function loadLibrary() {
  try {
    const o = JSON.parse(lsGet(LS_LIB) || lsGet(LEGACY_LIB_V9) || lsGet(LEGACY_LIB_V8) || '[]');
    state.library = Array.isArray(o)
      ? o.filter((e) => e && typeof e.id === 'string' && typeof e.pgn === 'string').slice(0, MAX_LIBRARY)
      : [];
  } catch (e) { state.library = []; }
}
function saveLibrary() {
  lsSet(LS_LIB, JSON.stringify(state.library));
}

function pgnDate(h) {
  const d = String((h && (h.EndDate || h.UTCDate || h.Date)) || '');
  const m = d.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m) {
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
    if (Number.isFinite(ts)) return { ts, dl: null };
  }
  const y = d.match(/^(\d{4})/);
  if (y) return { ts: null, dl: y[1] };
  return { ts: Date.now(), dl: null };
}

function fmtDateFull(ts) {
  try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
}
function entryDate(e) {
  return e.ts ? fmtDateFull(e.ts) : (e.dl || '');
}

function addToLibrary(pgn, g, meta) {
  try {
    if (!pgn || !g || String(pgn).length > 60000) return;
    meta = meta || {};
    const h = g.headers || {};
    const d = meta.ts ? { ts: meta.ts, dl: null } : pgnDate(h);
    const entry = {
      id: g.key,
      pgn: String(pgn),
      white: h.White || 'White',
      black: h.Black || 'Black',
      result: h.Result || '*',
      src: meta.src || 'pgn',
      ts: d.ts || null,
      dl: d.dl || null
    };
    const old = state.library.find((e) => e.id === entry.id);
    if (old && (old.ts || old.dl)) { entry.ts = old.ts; entry.dl = old.dl; }
    state.library = [entry].concat(state.library.filter((e) => e.id !== entry.id)).slice(0, MAX_LIBRARY);
    saveLibrary();
    renderGamesTab();
  } catch (e) { /* ignore */ }
}

function removeFromLibrary(id) {
  state.library = state.library.filter((e) => e.id !== id);
  saveLibrary();
  renderGamesTab();
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
    this.skill = 20;
    this.post('setoption name MultiPV value 1');
    await this.command('isready', 'readyok', 20000);
  },

  setSkill(n) {
    if (this.skill === n) return;
    this.skill = n;
    this.post('setoption name Skill Level value ' + n);
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

  /* One search at a time: game scan and What-if requests share the same worker.
     `skip` (optional) lets a queued request cancel itself before it starts. */
  chain: Promise.resolve(),
  analyze(fen, depth, multiPv, movetime, skip, skill) {
    const run = () => ((skip && skip()) ? null : this._analyze(fen, depth, multiPv, movetime, skill));
    const p = this.chain.then(run);
    this.chain = p.catch(() => {});
    return p;
  },

  _analyze(fen, depth, multiPv, movetime, skill) {
    return new Promise((resolve, reject) => {
      this.setSkill(skill == null ? 20 : skill);   /* 20 = full strength; lower only for the bot */
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
          const pv = line.split(' pv ')[1].trim().split(/\s+/);
          const move = pv[0];
          lines[mp ? +mp[1] : 1] = {
            depth: dp ? +dp[1] : 0,
            cp: sc[1] === 'cp' ? +sc[2] : null,
            mate: sc[1] === 'mate' ? +sc[2] : null,
            move,
            pv: pv.slice(0, 8)
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

async function analyzePosition(g, i, lv) {
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
  const mt = isOpening ? lv.openTime : lv.movetime;

  const res = await engine.analyze(fen, lv.depth, useMultiPv ? 2 : 1, mt);
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

/* ---------- classification (with tactical adjustments) ---------- */
function capCls(cls, max) {
  return (CLS_RANK[cls] != null && CLS_RANK[cls] > CLS_RANK[max]) ? max : cls;
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

  let bestSan = null;
  let bestMove = null;
  if (A.best) {
    const ch = new Chess();
    ch.load(g.fens[k]);
    const bm = ch.move(uciToMove(A.best));
    if (bm) { bestSan = bm.san; bestMove = bm; }
  }

  /* Theory moves are never penalized by the shallow engine */
  if (g.book && k < g.book.count) {
    state.results[k] = {
      cls: 'book', loss: 0, winBefore, winAfter, isBest, sac: false, tactical: false, onlyMove: false,
      bestSan, bestMove, comment: null
    };
    return;
  }

  /* Material context: did the move give material away? */
  const after = new Chess();
  after.load(g.fens[k + 1]);
  const gain = (mv.captured ? VAL[mv.captured] : 0) + (mv.promotion ? VAL[mv.promotion] - 1 : 0);
  const risk = after.game_over() ? 0 : bestCapture(after).net;
  const sac = (gain - risk) <= -2;

  /* Mate context (from the mover's point of view) */
  const mateMineAfter = B.mate != null && B.mate !== 0 && Math.sign(B.mate) === sgn && Math.abs(B.mate) <= 6;
  const mateTheirsAfter = B.mate != null && B.mate !== 0 && Math.sign(B.mate) === -sgn;
  const mateMineBefore = A.mate != null && A.mate !== 0 && Math.sign(A.mate) === sgn;

  const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);
  const inaccCutoff = k < 6 ? 8 : 5;

  let cls;
  if (isBest || loss <= 0.4) cls = 'best';
  else if (loss < inaccCutoff) cls = 'good';
  else if (loss < 10) cls = 'inaccuracy';
  else if (loss < 20) cls = 'mistake';
  else cls = 'blunder';

  /* Tactical reading: a move that keeps a decisive edge, a forced mate,
     or real compensation for a sacrifice is not a serious error. */
  const original = cls;
  if (CLS_RANK[cls] >= 2 && !mateTheirsAfter) {
    if (winBefore >= 93 && winAfter >= 75) cls = capCls(cls, 'good');
    if (mateMineAfter) cls = capCls(cls, 'good');
    else if (winAfter >= 90) cls = capCls(cls, 'good');
    else if (winAfter >= 80) cls = capCls(cls, 'inaccuracy');
    if (sac && winAfter >= 60) cls = capCls(cls, 'inaccuracy');
  }
  const tactical = cls !== original;

  let onlyMove = false;
  if (cls === 'best' || cls === 'good') {
    /* Brilliant = real sacrifice + real compensation + not already crushing */
    const compensated = mateMineAfter || winAfter >= 55;
    if (sac && loss <= 1.5 && compensated && winAfter >= winBefore - 3 && (winBefore <= 85 || mateMineAfter)) {
      cls = 'brilliant';
    } else if (isBest && cls === 'best' && A.second) {
      const prev = k > 0 ? g.moves[k - 1] : null;
      const recapture = !!(prev && prev.captured && mv.captured && prev.to === mv.to);
      const diff = winBefore - winPct(A.second.cp * sgn);
      if (diff >= (recapture ? 30 : 15)) { cls = 'great'; onlyMove = true; }
    }
  }

  state.results[k] = {
    cls, loss, winBefore, winAfter, isBest, sac, tactical, onlyMove,
    mateBefore: mateMineBefore, bestSan, bestMove, comment: null
  };
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
  const lv = engineLevel();
  const ckey = cacheKeyFor(g, lv);
  state.analysisDepth = lv.depth;
  state.analysis = new Array(n).fill(null);
  state.results = new Array(n - 1).fill(null);
  state.doneCount = 0;
  state.engineError = false;

  const cached = loadCache(ckey);
  if (cached && cached.length === n) {
    state.analysis = cached;
    for (let k = 0; k < n - 1; k++) { computeMoveResult(k); updateMoveTag(k); }
    state.doneCount = n;
    hideStatus();
    render();
    return;
  }

  setStatus('Loading engine\u2026', null);
  render();
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
      const a = await analyzePosition(g, i, lv);
      if (token !== state.token) return;
      state.analysis[i] = a;
      if (i > 0) { computeMoveResult(i - 1); updateMoveTag(i - 1); }
      state.doneCount = i + 1;
      setStatus('Scanning positions ' + (i + 1) + ' / ' + n + ' (' + lv.name + ', depth ' + lv.depth + ')', (i + 1) / n);
      if (Math.abs(state.ply - i) <= 1) render();
      else scheduleGraphs();
    }
    saveCache(ckey, state.analysis);
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
    const tacticalSac = c.sac && cls !== 'brilliant';
    if (tacticalSac) {
      if (keptMate) extras.push('It gives up material, but it sets up a forced mate in ' + Math.abs(B.mate) + '.');
      else if (c.winAfter >= 60) extras.push('It gives up material, but the attack and initiative more than make up for it.');
    }
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
    if (keptMate && extras.length < 2 && !tacticalSac) extras.push(who + ' now has a forced checkmate.');
  }

  if (cls === 'brilliant') {
    out.push(pick([
      'A brilliant sacrifice! Giving up material here is the engine\u2019s top choice.',
      'Brilliant! This sacrifice looks risky but the engine confirms it.',
      'A stunning idea \u2014 the material given up is more than repaid by the attack.'
    ], S));
    if (keptMate) out.push('It sets up a forced mate in ' + Math.abs(B.mate) + '.');
    out.push(c.winAfter >= 60 ? 'It keeps ' + who + ' firmly in control.' : 'It keeps the balance while creating real problems for ' + opp + '.');
  } else if (cls === 'book') {
    const op = c.opening;
    out.push(op
      ? pick([
          'A book move \u2014 standard theory in the ' + op + '.',
          'Known opening theory: this is a main-line move of the ' + op + '.',
          'Right out of the opening book (' + op + ').'
        ], S)
      : pick([
          'A book move \u2014 well-known opening theory.',
          'A standard theoretical move.',
          'Right out of the opening book.'
        ], S));
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
    if (c.bestSan && c.loss > 1.5 && !(c.tactical && keptMate)) { out.push('The engine slightly preferred ' + c.bestSan + '.'); bestHandled = true; }
  } else {
    const head = {
      inaccuracy: ['A small slip \u2014 it gives back part of the advantage.', 'An inaccuracy: playable, but there was something better.'],
      mistake: ['This is a mistake that noticeably shifts the evaluation.', 'A mistake \u2014 the position gets harder to hold.'],
      blunder: ['A blunder \u2014 this throws away a large part of the position.', 'That\u2019s a serious blunder that swings the game.']
    }[cls] || ['A questionable move.'];
    out.push(pick(head, S));

    let reason = null;
    if (mateTheirs) {
      reason = 'It allows ' + opp + ' to force checkmate in ' + Math.abs(B.mate) + '.';
    } else if (mateMine && !keptMate) {
      reason = 'It misses a forced checkmate in ' + Math.abs(A.mate) + (c.bestSan ? ' \u2014 ' + c.bestSan + ' was the way to go.' : '.');
      if (c.bestSan) bestHandled = true;
    } else if (c.sac && c.tactical) {
      reason = 'It gives up material for the initiative, and ' + who + ' keeps real compensation, though a cleaner path existed.';
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
    sac: !!R.sac,
    tactical: !!R.tactical,
    bestSan: R.bestSan,
    bestMove: R.bestMove,
    bestUci: state.analysis[k].best,
    opening: g.book && k < g.book.count ? (g.book.names[k] || null) : null,
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
    catch (e) { console.warn(e); R.comment = state.game.moves[k].san + ' \u2014 ' + (CLS[R.cls] || CLS.good).label + '.'; }
  }
  return R.comment;
}

/* =====================================================================
   Stats: accuracy, counts and heuristic game rating
   ===================================================================== */
/* Conservative performance curve: average win%-loss per (non-book) move -> rating.
   Deliberately modest at the top: a shallow engine cannot certify very high accuracy,
   because it misses tactics that a deeper search would punish. */
const ELO_CURVE = [[0, 2500], [2, 2100], [3.5, 1750], [5, 1450], [7, 1150], [10, 850], [14, 600], [20, 350], [30, 200]];

function perfFromLoss(loss) {
  const c = ELO_CURVE;
  if (loss <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (loss <= c[i][0]) {
      const a = c[i - 1];
      const b = c[i];
      return a[1] + (b[1] - a[1]) * (loss - a[0]) / (b[0] - a[0]);
    }
  }
  return c[c.length - 1][1];
}

const round10 = (v) => Math.round(v / 10) * 10;

function estimateElo(color, st, headers, ctx) {
  if (st.avgLoss == null || st.nb === 0) return null;
  const nb = st.nb;
  const cn = st.counts;
  const rate = (k) => (cn[k] || 0) / nb;

  /* performance: from the average loss, then a moderate penalty for how OFTEN errors happen */
  let perf = perfFromLoss(st.avgLoss) - (450 * rate('blunder') + 160 * rate('mistake') + 40 * rate('inaccuracy'));
  perf = clamp(perf, 150, 2500);

  /* credibility: shallow searches and short games say less about a player's real level */
  const depth = (ctx && ctx.depth) || DEPTH;
  const dq = clamp((depth - 6) / 10, 0.4, 1);   /* depth 8 -> .4, 11 -> .5, 14 -> .8 */
  const nq = nb / (nb + 20);                    /* 20 moves -> .5, 40 -> .67, 60 -> .75 */

  const base = parseInt(color === 'w' ? headers.WhiteElo : headers.BlackElo, 10);
  if (Number.isFinite(base) && base >= 100 && base <= 3500) {
    /* anchored on the rating of the game: only a gentle nudge, more room to go down than up */
    const delta = clamp((perf - base) * 0.5 * dq * nq, -250, 150);
    return { value: round10(clamp(base + delta, 100, 3200)), basis: 'base' };
  }
  /* no base rating: shrink toward a modest prior, so a few clean moves cannot inflate the result */
  const w = clamp(nq * (0.55 + 0.4 * dq), 0, 0.85);
  const elo = 1000 * (1 - w) + perf * w;
  return { value: round10(clamp(elo, 100, 2400)), basis: 'perf' };
}

function computeStats() {
  const g = state.game;
  const res = {};
  ['w', 'b'].forEach((color) => {
    const counts = {};
    let accSum = 0;
    let n = 0;
    let lossSum = 0;
    let nb = 0;
    g.moves.forEach((m, k) => {
      if (m.color !== color) return;
      const r = state.results[k];
      if (!r) return;
      counts[r.cls] = (counts[r.cls] || 0) + 1;
      const loss = Number.isFinite(r.loss) ? r.loss : 0;
      accSum += clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100);
      n++;
      if (r.cls !== 'book') { lossSum += loss; nb++; }
    });
    const st = { counts, n, nb, acc: n ? accSum / n : null, avgLoss: nb ? lossSum / nb : null };
    st.elo = estimateElo(color, st, g.headers || {}, { depth: state.analysisDepth || DEPTH });
    res[color] = st;
  });
  return res;
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

/* What is on the board: a lesson, an explored (what-if) line, or the real game */
function viewFen() {
  if (state.lesson) return state.lesson.fens[state.lesson.idx];
  if (state.explore) return state.explore.fens[state.explore.idx];
  return state.game ? state.game.fens[state.ply] : START_FEN;
}
function currentFen() { return viewFen(); }

function viewLastMove() {
  if (state.lesson) return state.lesson.idx > 0 ? state.lesson.moves[state.lesson.idx - 1] : null;
  if (state.explore) return state.explore.idx > 0 ? state.explore.moves[state.explore.idx - 1] : null;
  const g = state.game;
  return g && state.ply > 0 ? g.moves[state.ply - 1] : null;
}

let boardSig = '';

function renderBoard() {
  const boardEl = $('#board');
  const fen = viewFen();
  const last = viewLastMove();
  const sel = state.sel;
  const dragSq = state.drag && state.drag.ghost ? state.drag.sq : '';
  const anim = state.anim;
  state.anim = null;

  /* skip rebuilding identical boards: keeps running slide animations alive */
  const sig = [fen, state.flipped ? 1 : 0, last ? last.from + last.to : '', state.prefs.pieces,
    sel ? sel.sq + ':' + sel.targets.map((t) => t.to + (t.cap ? 'x' : '')).join(',') : '', dragSq].join('|');
  if (!anim && sig === boardSig && boardEl.firstChild) { sizeBoard(); return; }
  boardSig = sig;

  const ch = new Chess();
  ch.load(fen);
  const bd = ch.board();
  const tg = {};
  if (sel) sel.targets.forEach((t) => { tg[t.to] = t.cap ? 2 : 1; });

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
      if (sel && sq === sel.sq) cls += ' sel';
      if (tg[sq]) cls += ' tgt' + (tg[sq] === 2 ? ' cap' : '');
      if (sq === dragSq) cls += ' dragsrc';
      html += '<div class="' + cls + '" data-sq="' + sq + '">';
      if (dc === 0) html += '<span class="co r">' + rank + '</span>';
      if (dr === 7) html += '<span class="co f">' + 'abcdefgh'[file] + '</span>';
      if (p) html += pieceHtml(p.type, p.color);
      html += '</div>';
    }
  }
  boardEl.innerHTML = html;
  sizeBoard();
  if (anim) slidePieces(boardEl, anim);
}

function sizeBoard() {
  const b = $('#board');
  if (b && b.clientWidth) b.style.setProperty('--sq', (b.clientWidth / 8) + 'px');
}

function renderOverlay() {
  const svg = $('#overlay');
  const g = state.game;
  let h = '';
  if (state.lesson) {
    h = sessionOverlay();
  } else if (state.explore) {
    const a = exploreEval();
    if (a && a.best && a.best.length >= 4) h += arrowSvg(a.best.slice(0, 2), a.best.slice(2, 4));
  } else if (g) {
    // Turn-based best move: for move ply > 0, show best move for that turn (ply - 1).
    const turnIdx = state.ply > 0 ? state.ply - 1 : 0;
    const a = state.analysis[turnIdx];
    if (a && a.best && a.best.length >= 4) {
      h += arrowSvg(a.best.slice(0, 2), a.best.slice(2, 4));
    }
    if (state.ply > 0) {
      const r = state.results[state.ply - 1];
      if (r && CLS[r.cls]) {
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

function viewEval() {
  if (state.lesson) return state.lesson.kind === 'bot' ? (state.lesson.evals[state.lesson.fens[state.lesson.idx]] || null) : null;
  if (state.explore) return exploreEval();
  return state.game ? state.analysis[state.ply] : null;
}

function renderEval() {
  const bar = $('#evalbar');
  const fill = $('#eval-white');
  const label = $('#eval-label');
  bar.classList.toggle('wb', !state.flipped);
  bar.classList.toggle('wt', state.flipped);
  if (state.lesson && state.lesson.kind !== 'bot') {
    fill.style.height = '50%';
    label.className = 'eval-label ' + (state.flipped ? 'lt' : 'lb') + ' onwhite';
    label.textContent = '\u2013';
    return;
  }
  const a = viewEval();
  if ((state.explore || state.lesson) && !a) { label.textContent = '\u2026'; return; }   /* keep the bar while evaluating */
  const cp = a ? a.cp : 0;
  const pct = a ? winPct(cp) : 50;
  fill.style.height = pct.toFixed(1) + '%';
  const atBottom = (cp >= 0) !== state.flipped;
  label.className = 'eval-label ' + (atBottom ? 'lb' : 'lt') + ' ' + (cp >= 0 ? 'onwhite' : 'onblack');
  label.textContent = fmtBarLabel(a);
}

function renderPlayers() {
  const h = state.lesson ? sessionHeaders(state.lesson) : (state.game ? state.game.headers : {});
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
  const stats = computeStats();
  const cols = ['w', 'b'].map((color) => {
    const st = stats[color];
    const chips = CLS_ORDER.filter((k) => st.counts[k]).map((k) =>
      '<span class="sum-chip"><i style="background:' + CLS[k].color + ';color:' + CLS[k].fg + '">' + esc(CLS[k].sym) + '</i>' + st.counts[k] + '</span>').join('');
    const acc = st.acc != null ? Math.round(st.acc) + '%' : '\u2013';
    return '<div class="sum-col"><h3>' + (color === 'w' ? 'White' : 'Black') + '<span>' + acc + '</span></h3><div class="sum-chips">' + chips + '</div></div>';
  });
  return '<div class="summary">' + cols.join('') + '</div>';
}

function renderCard() {
  const el = $('#card');
  const g = state.game;
  if (state.lesson) { el.innerHTML = lessonCardHtml(); return; }
  if (state.explore && g) { el.innerHTML = exploreCardHtml(); return; }
  if (!g) {
    el.innerHTML = '<div class="empty"><h2>Welcome to ChessLens</h2>' +
      '<p>Import a game from Chess.com or paste a PGN to get engine analysis with plain-English commentary \u2014 all on your device.</p>' +
      '<div class="row gap"><button class="btn primary grow" data-open-import>Import a game</button>' +
      '<button class="btn ghost grow" data-open-learn>Learn openings</button></div></div>';
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
    if (g.book && g.book.opening) {
      const bn = g.book.count;
      html += '<div class="hint"><span class="swatch" style="background:' + CLS.book.color + '"></span>Opening: <b style="color:#d2a679">' +
        esc(g.book.opening) + '</b> \u00B7 ' + bn + (bn === 1 ? ' book move' : ' book moves') + '</div>';
    }
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

    if (r && CLS[r.cls]) {
      const cl = CLS[r.cls];
      html += '<div class="card-head"><div class="badge-lg" style="background:' + cl.color + ';color:' + cl.fg + '">' + esc(cl.sym) + '</div>' +
        '<div class="card-title">' + esc(mv.san) + '<small style="color:' + cl.color + '">' + cl.label + '</small></div>' +
        '<div class="chip-eval' + (state.analysis[state.ply].cp < 0 ? ' neg' : '') + '">' + esc(fmtEval(state.analysis[state.ply])) + '</div></div>';
      html += '<p class="card-text">' + esc(commentFor(k)) + '</p>';
      if (g.book && g.book.count > 0 && k === g.book.count) {
        html += '<p class="note" style="color:#d2a679">Out of book \u2014 the game leaves known opening theory here.</p>';
      }
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

  html += '<p class="tip">Tip: drag or tap a piece on the board to test a different move.</p>';
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
  if (!b || !r || !CLS[r.cls]) return;
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
  if (state.lesson) {
    const L = state.lesson;
    if (L.kind === 'study') {
      $('#btn-first').disabled = L.idx <= 0;
      $('#btn-prev').disabled = L.idx <= 0;
      $('#btn-next').disabled = L.idx >= L.moves.length;
      $('#btn-last').disabled = L.idx >= L.moves.length;
    } else {
      /* practice: "<" takes a move back; drills and bot games have no navigation */
      $('#btn-first').disabled = true;
      $('#btn-prev').disabled = !(L.kind === 'practice' && L.moves.length > 0);
      $('#btn-next').disabled = true;
      $('#btn-last').disabled = true;
    }
    return;
  }
  if (state.explore) {
    const ex = state.explore;
    $('#btn-first').disabled = ex.idx <= 0;
    $('#btn-prev').disabled = false;          /* at the start of the line it returns to the game */
    $('#btn-next').disabled = ex.idx >= ex.moves.length;
    $('#btn-last').disabled = ex.idx >= ex.moves.length;
    return;
  }
  const total = state.game ? state.game.moves.length : 0;
  $('#btn-first').disabled = state.ply <= 0;
  $('#btn-prev').disabled = state.ply <= 0;
  $('#btn-next').disabled = state.ply >= total;
  $('#btn-last').disabled = state.ply >= total;
}

/* =====================================================================
   Advantage graph (SVG, white win% over the game)
   ===================================================================== */
const GW = 600;
const GH = 150;
const GRAPH_MARK = { brilliant: 1, great: 1, mistake: 1, blunder: 1 };

function graphHtml(sel) {
  const g = state.game;
  if (!g) return '';
  const n = g.fens.length;
  let last = -1;
  for (let i = 0; i < n; i++) { if (state.analysis[i]) last = i; else break; }
  if (last < 0) return '<div class="graph-empty">The graph appears as the analysis runs\u2026</div>';

  const xs = (i) => (n > 1 ? (i / (n - 1)) * GW : 0);
  const ys = (i) => GH * (1 - winPct(state.analysis[i].cp) / 100);

  let h = '<svg class="gsvg" viewBox="0 0 ' + GW + ' ' + GH + '" role="img" aria-label="Advantage graph">' +
    '<rect width="' + GW + '" height="' + GH + '" fill="#3a3835"/>';

  if (last >= 1) {
    let pts = '';
    for (let i = 0; i <= last; i++) pts += xs(i).toFixed(1) + ',' + ys(i).toFixed(1) + ' ';
    h += '<polygon fill="#f2f2f2" points="0,' + GH + ' ' + pts + xs(last).toFixed(1) + ',' + GH + '"/>';
    h += '<polyline fill="none" stroke="#b8b6b1" stroke-width="1.5" stroke-linejoin="round" points="' + pts + '"/>';
  }
  h += '<line x1="0" y1="' + (GH / 2) + '" x2="' + GW + '" y2="' + (GH / 2) + '" stroke="#81b64c" stroke-opacity=".6" stroke-width="1" stroke-dasharray="5 5"/>';

  /* markers for notable moves */
  g.moves.forEach((m, k) => {
    const r = state.results[k];
    if (!r || !GRAPH_MARK[r.cls] || !state.analysis[k + 1]) return;
    const cl = CLS[r.cls];
    h += '<circle cx="' + xs(k + 1).toFixed(1) + '" cy="' + ys(k + 1).toFixed(1) + '" r="5" fill="' + cl.color + '" stroke="#262421" stroke-width="1.5"/>';
  });

  /* selected ply */
  if (sel != null && sel >= 0 && sel <= last) {
    const sx = xs(sel).toFixed(1);
    h += '<line x1="' + sx + '" y1="0" x2="' + sx + '" y2="' + GH + '" stroke="#81b64c" stroke-width="2"/>' +
         '<circle cx="' + sx + '" cy="' + ys(sel).toFixed(1) + '" r="5.5" fill="#fff" stroke="#81b64c" stroke-width="2.5"/>';
  }
  h += '</svg>';
  return h;
}

function plyFromEvent(el, e) {
  const svg = el.querySelector('svg');
  if (!svg || !state.game) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width) return null;
  const n = state.game.fens.length;
  return Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (n - 1));
}

function bindGraph(el, handler) {
  if (!el) return;
  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = plyFromEvent(el, e);
    if (p != null) handler(p);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = plyFromEvent(el, e);
    if (p != null) handler(p);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) =>
    el.addEventListener(t, () => { dragging = false; }));
}

function renderGraphMain() {
  const card = $('#graph-card');
  const el = $('#graph');
  if (!card || !el) return;
  card.hidden = !state.game || !!state.lesson;
  if (!state.game) { el.innerHTML = ''; return; }
  el.innerHTML = graphHtml(state.ply);
}

let gfxQueued = false;
function scheduleGraphs() {
  if (gfxQueued) return;
  gfxQueued = true;
  requestAnimationFrame(() => {
    gfxQueued = false;
    renderGraphMain();
    if (!$('#report').hidden) renderReport();
  });
}

/* =====================================================================
   Game summary (report)
   ===================================================================== */
function plyInfoHtml(p) {
  const g = state.game;
  if (p == null || !g) return '<span class="muted">Tap or drag on the graph to inspect any move.</span>';
  if (p === 0) return '<b>Start position</b>';
  const k = p - 1;
  const mv = g.moves[k];
  if (!mv) return '';
  const r = state.results[k];
  const a = state.analysis[p];
  const num = (Math.floor(k / 2) + 1) + (mv.color === 'w' ? '.' : '\u2026');
  let h = '<b>' + num + ' ' + esc(mv.san) + '</b>';
  if (r && CLS[r.cls]) {
    const cl = CLS[r.cls];
    h += '<span class="ipill" style="background:' + cl.color + ';color:' + cl.fg + '">' + esc(cl.sym) + ' ' + cl.label + '</span>';
  }
  if (a) h += '<span class="muted">Eval ' + esc(fmtEval(a)) + '</span>';
  return h;
}

function keyMomentsHtml() {
  const g = state.game;
  const pri = { blunder: 0, brilliant: 1, mistake: 2, great: 3 };
  const list = [];
  g.moves.forEach((m, k) => {
    const r = state.results[k];
    if (r && pri[r.cls] != null) list.push({ k, cls: r.cls, loss: r.loss || 0 });
  });
  if (!list.length) return '';
  list.sort((a, b) => (pri[a.cls] - pri[b.cls]) || (b.loss - a.loss));
  const top = list.slice(0, 8).sort((a, b) => a.k - b.k);
  return '<h3 class="rep-h">Key moments</h3><div class="kchips">' + top.map((t) => {
    const m = g.moves[t.k];
    const cl = CLS[t.cls];
    const num = (Math.floor(t.k / 2) + 1) + (m.color === 'w' ? '.' : '\u2026');
    return '<button class="kchip" data-ply="' + (t.k + 1) + '" aria-pressed="' + (state.repSel === t.k + 1) + '">' +
      '<i style="background:' + cl.color + ';color:' + cl.fg + '">' + esc(cl.sym) + '</i>' + esc(num + ' ' + m.san) + '</button>';
  }).join('') + '</div>';
}

function renderReportGraph() {
  const el = $('#report-graph');
  if (el && state.game) el.innerHTML = graphHtml(state.repSel);
}
function renderReportInfo() {
  const el = $('#report-info');
  if (el) el.innerHTML = plyInfoHtml(state.repSel);
}
function renderReportChips() {
  const el = $('#report-chips');
  if (el && state.game) el.innerHTML = keyMomentsHtml();
}

function selectRep(p) {
  if (!state.game) return;
  state.repSel = clamp(p, 0, state.game.moves.length);
  renderReportGraph();
  renderReportInfo();
  renderReportChips();
}

function renderReport() {
  const g = state.game;
  if (!g) return;
  const h = g.headers || {};
  const n = g.fens.length;
  const done = state.doneCount >= n;
  const pct = Math.round(clamp(state.doneCount / n, 0, 1) * 100);

  /* header: players */
  const who = (name, elo, c) => '<div class="rep-p"><span class="dot ' + c + '"></span><span class="pname">' + esc(name) + '</span>' +
    (elo && elo !== '?' ? '<span class="pelo">(' + esc(elo) + ')</span>' : '') + '</div>';
  $('#report-head').innerHTML = who(h.White || 'White', h.WhiteElo, 'w') + who(h.Black || 'Black', h.BlackElo, 'b');

  /* progress */
  let prog = '';
  if (state.engineError) {
    prog = '<p class="note">The engine could not be loaded, so the summary is unavailable. Connect to the internet and reload.</p>';
  } else if (!done) {
    prog = '<div class="status-row"><span>Analyzing\u2026 ' + state.doneCount + ' / ' + n + '</span><span>' + pct + '%</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>';
  }
  $('#report-progress').innerHTML = prog;

  renderReportGraph();
  renderReportInfo();
  renderReportChips();

  /* stats */
  const stats = computeStats();
  const cols = ['w', 'b'].map((c) => {
    const st = stats[c];
    const acc = st.acc != null ? st.acc.toFixed(1) + '%' : '\u2013';
    const elo = done && st.elo ? String(st.elo.value) : (done ? '\u2013' : '\u2026');
    return '<div class="rep-col"><div class="rep-who"><span class="dot ' + c + '"></span>' + (c === 'w' ? 'White' : 'Black') + '</div>' +
      '<div class="rep-big acc">' + acc + '</div><small>Accuracy</small>' +
      '<div class="rep-big">' + elo + '</div><small>Game rating</small></div>';
  }).join('');

  const rows = CLS_ORDER.map((k) => {
    const cw = stats.w.counts[k] || 0;
    const cb = stats.b.counts[k] || 0;
    const cl = CLS[k];
    return '<tr><td class="n' + (cw ? '' : ' zero') + '">' + cw + '</td>' +
      '<td class="lab"><i style="background:' + cl.color + ';color:' + cl.fg + '">' + esc(cl.sym) + '</i>' + cl.label + '</td>' +
      '<td class="n' + (cb ? '' : ' zero') + '">' + cb + '</td></tr>';
  }).join('');

  let html = '<div class="rep-cols">' + cols + '</div>';
  html += '<table class="rep-table" aria-label="Move classifications"><tbody>' + rows + '</tbody></table>';
  if (g.book && g.book.opening) {
    html += '<p class="rep-open">Opening: <b>' + esc(g.book.opening) + '</b> \u00B7 ' + g.book.count + (g.book.count === 1 ? ' book move' : ' book moves') + '</p>';
  }
  html += '<p class="rep-note">Game rating is a rough, deliberately conservative local estimate based on average loss per move and how often mistakes happen' +
    (h.WhiteElo || h.BlackElo ? ', anchored on the ratings in the game' : '') + '. Analyzed at ' + esc(engineLevel().name) + ' strength (depth ' +
    state.analysisDepth + '). It is not an official rating.</p>';
  $('#report-stats').innerHTML = html;
}

function openReport(sel) {
  if (!state.game) return;
  closeSheet();
  state.repSel = sel == null ? null : clamp(sel, 0, state.game.moves.length);
  $('#report').hidden = false;
  document.body.style.overflow = 'hidden';
  renderReport();
  const body = $('#report-body');
  if (body) body.scrollTop = 0;
}

function onViewBoard() {
  if (!state.game) { closeSheet(); return; }
  const p = state.repSel != null ? state.repSel : 0;
  closeSheet();
  state.explore = null;
  state.exploreReq++;
  state.ply = clamp(p, 0, state.game.moves.length);
  render();
}

function render() {
  renderBoard();
  renderOverlay();
  renderEval();
  renderPlayers();
  renderCard();
  renderMoveActive();
  renderControls();
  renderGraphMain();
  renderModeBar();
  if ($('#report') && !$('#report').hidden) renderReport();
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
  const g = state.game;
  const np = clamp(p, 0, g.moves.length);
  const wasExploring = !!state.explore;
  if (np === state.ply && !wasExploring) return;
  clearTransient();
  const delta = np - state.ply;
  if (wasExploring) { state.explore = null; state.exploreReq++; }
  state.ply = np;
  if (!wasExploring && delta === 1) {
    const m = g.moves[np - 1];
    state.anim = moveAnim(m, false);
    soundFor(m);
  } else if (!wasExploring && delta === -1) {
    state.anim = moveAnim(g.moves[np], true);
  }
  render();
}

function loadGame(pgn, opts) {
  opts = opts || {};
  let g;
  try { g = parsePgn(pgn); }
  catch (e) { return { error: e.message }; }
  state.game = g;
  state.ply = 0;
  state.repSel = null;
  clearTransient();
  state.explore = null;
  state.exploreReq++;
  if (state.lesson) killSession(state.lesson);
  state.lesson = null;
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

/* Chess.com recent games (Games tab) */
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
    const date = g.end_time ? fmtDateFull(g.end_time * 1000) : '';
    const tclass = g.time_class ? cap(g.time_class) : '';
    const btn = document.createElement('button');
    btn.className = 'game';
    btn.dataset.i = String(i);
    btn.innerHTML = '<span class="gcol ' + (iAmWhite ? 'w' : 'b') + '"></span>' +
      '<span class="gmain"><b>' + esc(opp.username || 'Opponent') + ' (' + esc(opp.rating != null ? opp.rating : '?') + ')</b>' +
      '<small>' + esc([date, 'You ' + (me.rating != null ? me.rating : '?'), [tclass, fmtTimeControl(g)].filter(Boolean).join(' ')].filter(Boolean).join(' \u00B7 ')) + '</small></span>' +
      '<span class="gres ' + res + '">' + word + '</span>';
    list.appendChild(btn);
  });
}

/* Saved games (Games tab) */
function libItemHtml(e) {
  const u = (state.username || '').toLowerCase();
  const wn = String(e.white || '').toLowerCase();
  const bn = String(e.black || '').toLowerCase();
  let mine = null;
  if (u && wn === u) mine = 'w';
  else if (u && bn === u) mine = 'b';
  let res = 'draw';
  let word = e.result && e.result !== '*' ? e.result : '\u2013';
  if (mine && (e.result === '1-0' || e.result === '0-1')) {
    const won = (e.result === '1-0') === (mine === 'w');
    res = won ? 'won' : 'lost';
    word = won ? 'Won' : 'Lost';
  } else if (e.result === '1/2-1/2') {
    word = 'Draw';
  }
  const src = e.src === 'chesscom' ? 'Chess.com' : (e.src === 'sample' ? 'Sample' : (e.src === 'bot' ? 'Bot game' : 'PGN'));
  const sub = [entryDate(e), src].filter(Boolean).join(' \u00B7 ');
  return '<div class="gitem">' +
    '<button class="game" data-lib="' + esc(e.id) + '">' +
    '<span class="gcol ' + (mine || 'n') + '"></span>' +
    '<span class="gmain"><b>' + esc(e.white || 'White') + ' vs ' + esc(e.black || 'Black') + '</b><small>' + esc(sub) + '</small></span>' +
    '<span class="gres ' + res + '">' + esc(word) + '</span></button>' +
    '<button class="icon-btn lib-del" data-lib-del="' + esc(e.id) + '" aria-label="Remove game">\u2715</button>' +
    '</div>';
}

function renderGamesTab() {
  const cc = $('#games-chesscom');
  const lib = $('#lib-list');
  if (!cc || !lib) return;
  const hasList = state.listGames.length > 0 && !!state.listUser;
  cc.hidden = !hasList;
  if (hasList) {
    $('#glist-title').textContent = 'Chess.com \u00B7 ' + state.listUser;
    renderGameList(state.listGames, state.listUser);
  } else {
    $('#glist').innerHTML = '';
  }
  const hasLib = state.library.length > 0;
  $('#games-saved').hidden = !hasLib;
  lib.innerHTML = state.library.map(libItemHtml).join('');
  $('#games-empty').hidden = hasList || hasLib;
}

function hasGames() {
  return state.library.length > 0 || state.listGames.length > 0;
}

/* ---------- sheets: import/games + settings ---------- */
function openSheet(tab) {
  $('#report').hidden = true;
  $('#settings').hidden = true;
  $('#sheet').hidden = false;
  $('#in-user').value = state.username || '';
  renderUserChips();
  renderGamesTab();
  renderLearnTab();
  renderPlayTab();
  switchTab(tab || (hasGames() ? 'games' : 'import'));
  document.body.style.overflow = 'hidden';
  const key = (state.username || '').toLowerCase();
  if (key && state.listUser !== key && state.listLoadingFor !== key) onLoadGames({ goto: false });
}
function openSettings() {
  $('#sheet').hidden = true;
  $('#report').hidden = true;
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
  $('#report').hidden = true;
  document.body.style.overflow = '';
}
function anySheetOpen() {
  return !$('#sheet').hidden || !$('#settings').hidden || !$('#report').hidden;
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#tab-import').hidden = name !== 'import';
  $('#tab-games').hidden = name !== 'games';
  $('#tab-learn').hidden = name !== 'learn';
  $('#tab-play').hidden = name !== 'play';
}

function setMsg(id, text, isErr) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}
function setUserMsg(text, isErr) {
  setMsg('#user-msg', text, isErr);
  setMsg('#games-msg', text, isErr);
}

async function onLoadGames(opts) {
  const goto = !!(opts && opts.goto);
  const input = $('#in-user');
  const username = input.value.trim().replace(/^@/, '');
  if (!username) { setUserMsg('Enter your Chess.com username.', true); return; }
  const key = username.toLowerCase();
  const req = ++state.listReq;
  state.listLoadingFor = key;
  const btn = $('#btn-load-games');
  btn.disabled = true;
  setUserMsg('Loading games\u2026');
  try {
    const games = await fetchRecentGames(username);
    if (req !== state.listReq) return;
    const saved = addProfile(username);
    input.value = saved.name || username;
    state.listGames = games;
    state.listUser = key;
    renderGamesTab();
    if (!games.length) {
      setUserMsg('No standard-chess games found for "' + username + '".', true);
    } else {
      setUserMsg('Tap a game to see its summary.');
      if (goto) switchTab('games');
    }
  } catch (e) {
    if (req !== state.listReq) return;
    setUserMsg(e.message === 'NOT_FOUND' ? 'User "' + username + '" was not found on Chess.com.' : e.message, true);
  } finally {
    if (req === state.listReq) {
      btn.disabled = false;
      state.listLoadingFor = '';
    }
  }
}

function onRefreshGames() {
  if (!state.username) { switchTab('import'); setUserMsg('Enter your Chess.com username.', true); return; }
  $('#in-user').value = state.username;
  onLoadGames({ goto: false });
}

function onPickGame(i) {
  const g = state.listGames[i];
  if (!g) return;
  const u = state.listUser || (state.username || '').toLowerCase();
  const myColor = (g.white.username || '').toLowerCase() === u ? 'w' : 'b';
  const r = loadGame(g.pgn, { myColor });
  if (r.error) { setUserMsg(r.error, true); return; }
  addToLibrary(g.pgn, state.game, { ts: g.end_time ? g.end_time * 1000 : null, src: 'chesscom' });
  openReport();
}

function onPickLib(id) {
  const e = state.library.find((x) => x.id === id);
  if (!e) return;
  const r = loadGame(e.pgn, {});
  if (r.error) { setUserMsg(r.error, true); return; }
  addToLibrary(e.pgn, state.game, { src: e.src });
  openReport();
}

function onLoadPgn() {
  const text = $('#in-pgn').value;
  const r = loadGame(text, {});
  if (r.error) { setMsg('#pgn-msg', r.error, true); return; }
  setMsg('#pgn-msg', '');
  addToLibrary(text, state.game, { src: 'pgn' });
  openReport();
}

function onLoadSample() {
  $('#in-pgn').value = SAMPLE_PGN;
  const r = loadGame(SAMPLE_PGN, { myColor: 'w' });
  if (r.error) { setMsg('#pgn-msg', r.error, true); return; }
  setMsg('#pgn-msg', '');
  addToLibrary(SAMPLE_PGN, state.game, { src: 'sample' });
  openReport();
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

/* =====================================================================
   v9 features: move sounds, slide animation, engine strength,
   "What if" exploration (+ Back to the game) and guided openings
   ===================================================================== */

/* ---------- synthesized move sounds (Web Audio, no files) ---------- */
const sfx = {
  ctx: null,
  master: null,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; return null; }
    }
    if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
    return this.ctx;
  },

  env(g, t, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  },

  tone(freq, t, dur, type, vol, endFreq) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    this.env(g, t, vol, dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  },

  noise(t, dur, vol, freq, q) {
    const c = this.ctx;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, vol, dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t);
  },

  /* kind: move | castle | capture | check | mate */
  play(kind) {
    if (!state.prefs.sound) return;
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime + 0.005;
    try {
      const thud = (at) => { this.tone(210, at, 0.08, 'triangle', 0.55, 110); this.noise(at, 0.035, 0.22, 2200, 0.9); };
      if (kind === 'capture') {
        this.noise(t, 0.09, 0.6, 1400, 0.7);
        this.tone(160, t, 0.14, 'triangle', 0.7, 70);
        this.tone(900, t, 0.03, 'square', 0.08);
      } else if (kind === 'castle') {
        thud(t);
        thud(t + 0.1);
      } else if (kind === 'check') {
        thud(t);
        this.tone(740, t + 0.07, 0.12, 'sine', 0.3);
        this.tone(988, t + 0.16, 0.18, 'sine', 0.3);
      } else if (kind === 'mate') {
        this.noise(t, 0.09, 0.6, 1400, 0.7);
        this.tone(160, t, 0.14, 'triangle', 0.7, 70);
        this.tone(523.25, t + 0.08, 0.35, 'sine', 0.3);
        this.tone(392, t + 0.2, 0.35, 'sine', 0.3);
        this.tone(261.6, t + 0.34, 0.7, 'sine', 0.35);
        this.tone(130.8, t + 0.34, 0.9, 'triangle', 0.3);
      } else {
        thud(t);
      }
    } catch (e) { /* audio is best-effort */ }
  }
};

function soundFor(m) {
  if (!m) return;
  const san = m.san || '';
  const f = m.flags || '';
  if (san.indexOf('#') >= 0) sfx.play('mate');
  else if (san.indexOf('+') >= 0) sfx.play('check');
  else if (m.captured) sfx.play('capture');
  else if (f.indexOf('k') >= 0 || f.indexOf('q') >= 0) sfx.play('castle');
  else sfx.play('move');
}

/* ---------- slide animation (FLIP: new DOM is placed, then animated from the old square) ---------- */
function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function castleRook(m) {
  const f = m.flags || '';
  const rank = m.color === 'w' ? '1' : '8';
  if (f.indexOf('k') >= 0) return { from: 'h' + rank, to: 'f' + rank };
  if (f.indexOf('q') >= 0) return { from: 'a' + rank, to: 'd' + rank };
  return null;
}

/* The piece always ends on `to`; `reverse` plays the move backwards (the piece is already back on `from`) */
function moveAnim(m, reverse) {
  const list = [reverse ? { from: m.to, to: m.from } : { from: m.from, to: m.to }];
  const r = castleRook(m);
  if (r) list.push(reverse ? { from: r.to, to: r.from } : r);
  return list;
}

function slidePieces(boardEl, list) {
  if (!list || !list.length || reducedMotion()) return;
  const size = boardEl.clientWidth / 8;
  if (!size) return;
  list.forEach((s) => {
    const sq = boardEl.querySelector('.sq[data-sq="' + s.to + '"]');
    const el = sq && sq.querySelector('.pc-img, .pc');
    if (!el || !el.animate) return;
    const a = sqXY(s.from);
    const b = sqXY(s.to);
    const dx = (a.x - b.x) * size;
    const dy = (a.y - b.y) * size;
    if (!dx && !dy) return;
    el.style.zIndex = '20';
    const an = el.animate(
      [{ transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)' }, { transform: 'translate(0,0)' }],
      { duration: 180, easing: 'cubic-bezier(.22,.7,.3,1)' }
    );
    const done = () => { el.style.zIndex = ''; };
    an.onfinish = done;
    an.oncancel = done;
  });
}

/* ---------- engine strength + preferences ---------- */
function engineLevel() {
  const base = ENGINE_LEVELS.find((l) => l.id === state.prefs.engine) || ENGINE_LEVELS[1];
  if (!LOW_END || base.id !== 'strong') return base;
  /* modest hardware: keep the deeper preset but cap the time per position */
  return Object.assign({}, base, { movetime: 300, openTime: 380, xTime: 800 });
}

function cacheKeyFor(g, lv) { return g.key + ':' + lv.id; }

function savePrefs() { lsSet(LS_PREFS, JSON.stringify(state.prefs)); }

function setEngineLevel(id) {
  if (!ENGINE_LEVELS.some((l) => l.id === id) || state.prefs.engine === id) return;
  state.prefs.engine = id;
  savePrefs();
  renderAppearance();
  const lv = engineLevel();
  if (state.game) {
    if (state.explore) state.explore.evals = {};
    setMsg('#engine-msg', lv.name + ' selected \u2014 re-analyzing the open game\u2026');
    buildMoveList();
    startAnalysis();
    render();
    if (state.explore) requestExploreEval();
  } else {
    setMsg('#engine-msg', lv.name + ' selected.');
  }
}

function setSound(on) {
  state.prefs.sound = !!on;
  savePrefs();
  renderAppearance();
  if (on) sfx.play('move');
}

/* ---------- helpers: SAN lines ---------- */
function sanLine(startFen, sans) {
  const p = startFen.split(' ');
  let white = p[1] === 'w';
  let n = parseInt(p[5], 10) || 1;
  let out = '';
  sans.forEach((s, i) => {
    if (white) out += (out ? ' ' : '') + n + '. ' + s;
    else out += (out ? ' ' : '') + (i === 0 ? n + '\u2026 ' : '') + s;
    if (!white) n++;
    white = !white;
  });
  return out;
}

function pvToSan(fen, pv, max) {
  const ch = new Chess();
  if (!ch.load(fen)) return [];
  const out = [];
  for (let i = 0; i < pv.length && i < max; i++) {
    const m = ch.move(uciToMove(pv[i]));
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/* ---------- What-if exploration ---------- */
function exploreEval() {
  const ex = state.explore;
  return ex ? (ex.evals[ex.fens[ex.idx]] || null) : null;
}

async function analyzeFenQuick(fen, lv, skip) {
  const ch = new Chess();
  if (!ch.load(fen)) return null;
  const turn = ch.turn();
  if (ch.in_checkmate()) return { cp: turn === 'w' ? -10000 : 10000, mate: 0, best: null, pv: [] };
  if (ch.game_over()) return { cp: 0, mate: null, best: null, pv: [] };
  const res = await engine.analyze(fen, lv.xDepth, 1, lv.xTime, skip);
  if (!res) return null;
  const l1 = res.lines[1];
  const best = res.best && res.best !== '(none)' ? res.best : (l1 ? l1.move : null);
  if (!l1) return { cp: 0, mate: null, best, pv: best ? [best] : [] };
  const w = toWhite(l1, turn);
  return { cp: w.cp, mate: w.mate, best, pv: l1.pv && l1.pv.length ? l1.pv : [best] };
}

function renderExploreUi() {
  renderEval();
  renderOverlay();
  renderCard();
  renderModeBar();
}

async function requestExploreEval() {
  const ex = state.explore;
  if (!ex) return;
  const fen = ex.fens[ex.idx];
  if (ex.evals[fen]) { renderExploreUi(); return; }
  const req = ++state.exploreReq;
  ex.error = false;
  renderExploreUi();
  const ok = await engine.init();
  if (!ok) {
    if (state.explore === ex) { ex.error = true; renderExploreUi(); }
    return;
  }
  if (req !== state.exploreReq || state.explore !== ex) return;
  try {
    const a = await analyzeFenQuick(fen, engineLevel(), () => req !== state.exploreReq || state.explore !== ex);
    if (!a) return;
    ex.evals[fen] = a;
  } catch (err) {
    if (state.explore === ex) ex.error = true;
  }
  if (state.explore === ex && ex.fens[ex.idx] === fen) renderExploreUi();
}

function clearTransient() {
  state.sel = null;
  closePromo();
}

function exitExplore() {
  if (!state.explore) return;
  clearTransient();
  state.explore = null;
  state.exploreReq++;
  render();
}

/* Plays a move from the position currently on the board. Following the game's own move just steps forward. */
function commitMove(from, to, promo) {
  if (state.lesson) {
    state.sel = null;
    const okk = sessionMove(from, to, promo);
    if (!okk) renderBoard();
    return okk;
  }
  const ch = new Chess();
  ch.load(viewFen());
  const m = ch.move({ from, to, promotion: promo || undefined });
  state.sel = null;
  if (!m) { renderBoard(); return false; }
  const g = state.game;
  let ex = state.explore;
  if (!ex && g && state.ply < g.moves.length) {
    const gm = g.moves[state.ply];
    if (gm.from === m.from && gm.to === m.to && (gm.promotion || '') === (m.promotion || '')) {
      goTo(state.ply + 1);
      return true;
    }
  }
  if (!ex) {
    ex = state.explore = { basePly: state.ply, fens: [viewFen()], moves: [], idx: 0, evals: {}, error: false };
  }
  const nxt = ex.moves[ex.idx];
  if (nxt && nxt.from === m.from && nxt.to === m.to && (nxt.promotion || '') === (m.promotion || '')) {
    ex.idx++;
  } else {
    ex.moves = ex.moves.slice(0, ex.idx);
    ex.fens = ex.fens.slice(0, ex.idx + 1);
    ex.moves.push(m);
    ex.fens.push(ch.fen());
    ex.idx++;
  }
  state.anim = moveAnim(m, false);
  soundFor(m);
  render();
  requestExploreEval();
  return true;
}

/* ---------- navigation (works for the game, an explored line and a lesson) ---------- */
function navPrev() {
  if (state.lesson) { lessonNav('prev'); return; }
  const ex = state.explore;
  if (ex) {
    clearTransient();
    if (ex.idx <= 0) { exitExplore(); return; }
    ex.idx--;
    state.anim = moveAnim(ex.moves[ex.idx], true);
    render();
    requestExploreEval();
    return;
  }
  goTo(state.ply - 1);
}

function navNext() {
  if (state.lesson) { lessonNav('next'); return; }
  const ex = state.explore;
  if (ex) {
    if (ex.idx >= ex.moves.length) return;
    clearTransient();
    const m = ex.moves[ex.idx];
    ex.idx++;
    state.anim = moveAnim(m, false);
    soundFor(m);
    render();
    requestExploreEval();
    return;
  }
  goTo(state.ply + 1);
}

function navFirst() {
  if (state.lesson) { lessonNav('first'); return; }
  const ex = state.explore;
  if (ex) {
    clearTransient();
    ex.idx = 0;
    render();
    requestExploreEval();
    return;
  }
  goTo(0);
}

function navLast() {
  if (state.lesson) { lessonNav('last'); return; }
  const ex = state.explore;
  if (ex) {
    clearTransient();
    ex.idx = ex.moves.length;
    render();
    requestExploreEval();
    return;
  }
  goTo(state.game ? state.game.moves.length : 0);
}

/* ---------- board interaction: tap to select / tap to move / drag and drop ---------- */
const DRAG_PX = 6;

function sqAtEvent(e) {
  const r = $('#board').getBoundingClientRect();
  if (!r.width) return null;
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
  let col = Math.floor(x * 8);
  let row = Math.floor(y * 8);
  if (state.flipped) { col = 7 - col; row = 7 - row; }
  return 'abcdefgh'[col] + (8 - row);
}

function onBoardDown(e) {
  if (!boardInteractive()) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const sq = sqAtEvent(e);
  if (!sq) return;
  const ch = new Chess();
  ch.load(viewFen());
  if (ch.game_over()) return;

  if (state.sel && state.sel.targets.some((t) => t.to === sq)) {
    e.preventDefault();
    attemptMove(state.sel.sq, sq);
    return;
  }
  const p = ch.get(sq);
  if (p && p.color === ch.turn() && (!state.lesson || p.color === state.lesson.userColor)) {
    const wasSel = !!(state.sel && state.sel.sq === sq);
    const seen = {};
    const targets = [];
    ch.moves({ square: sq, verbose: true }).forEach((m) => {
      if (seen[m.to]) return;
      seen[m.to] = 1;
      targets.push({ to: m.to, cap: !!m.captured });
    });
    state.sel = { sq, targets };
    state.drag = { sq, pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, wasSel, piece: p };
    try { $('#board-box').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
    renderBoard();
  } else if (state.sel) {
    state.sel = null;
    renderBoard();
  }
}

function onBoardMove(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pid) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_PX) return;
    d.moved = true;
    const b = $('#board');
    const size = (b.clientWidth / 8) * 1.1;
    const gh = document.createElement('div');
    gh.className = 'drag-ghost';
    gh.style.setProperty('--sq', size + 'px');
    gh.style.width = size + 'px';
    gh.style.height = size + 'px';
    gh.innerHTML = pieceHtml(d.piece.type, d.piece.color);
    document.body.appendChild(gh);
    d.ghost = gh;
    const src = b.querySelector('.sq[data-sq="' + d.sq + '"]');
    if (src) src.classList.add('dragsrc');
  }
  d.ghost.style.left = e.clientX + 'px';
  d.ghost.style.top = e.clientY + 'px';
}

function endDrag(e, cancel) {
  const d = state.drag;
  if (!d) return;
  if (e && e.pointerId !== d.pid) return;
  state.drag = null;
  if (d.ghost) d.ghost.remove();
  try { $('#board-box').releasePointerCapture(d.pid); } catch (err) { /* ignore */ }
  if (cancel) { renderBoard(); return; }
  const to = e ? sqAtEvent(e) : null;
  if (d.moved) {
    if (to && to !== d.sq && state.sel && state.sel.targets.some((t) => t.to === to)) attemptMove(d.sq, to);
    else { state.sel = null; renderBoard(); }
  } else if (d.wasSel) {
    state.sel = null;
    renderBoard();
  } else {
    renderBoard();
  }
}

function attemptMove(from, to) {
  const ch = new Chess();
  ch.load(viewFen());
  const list = ch.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!list.length) { state.sel = null; renderBoard(); return; }
  if (list[0].promotion) { openPromo(from, to, ch.turn()); return; }
  commitMove(from, to, null);
}

function openPromo(from, to, color) {
  closePromo();
  state.promo = { from, to, color };
  const box = $('#board-box');
  const el = document.createElement('div');
  el.id = 'promo';
  el.className = 'promo';
  el.innerHTML = '<div class="promo-row" style="--sq:' + Math.round(Math.min(64, box.clientWidth / 6)) + 'px">' +
    ['q', 'r', 'b', 'n'].map((t) =>
      '<button class="promo-btn" data-promo="' + t + '" aria-label="Promote to ' + NAME[t] + '">' + pieceHtml(t, color) + '</button>'
    ).join('') + '</div>';
  box.appendChild(el);
}

function closePromo() {
  state.promo = null;
  const el = document.getElementById('promo');
  if (el) el.remove();
}

/* =====================================================================
   v10: board sessions  (study | practice | drill | bot)
   A "session" lives in state.lesson and shares the board with the game:
     study    - step through an opening line (read only)
     practice - you play the line, the app validates every move
     drill    - interactive lessons (castling, pins, mates...)
     bot      - play against the local engine with coach feedback
   ===================================================================== */
const BOT_LEVELS = [
  { id: 'beginner', name: 'Beginner', desc: '\u2248 600 \u00B7 plays loose', skill: 0,  depth: 1,  time: 80 },
  { id: 'easy',     name: 'Easy',     desc: '\u2248 1000',                   skill: 4,  depth: 3,  time: 150 },
  { id: 'medium',   name: 'Medium',   desc: '\u2248 1400',                   skill: 10, depth: 6,  time: 300 },
  { id: 'hard',     name: 'Hard',     desc: '\u2248 1800',                   skill: 16, depth: 10, time: 500 }
];

let sessionSeq = 0;

function turnOf(L) { return L.fens[L.idx].split(' ')[1]; }

function killSession(L) {
  if (!L) return;
  L.dead = true;
  clearTimeout(L.timer);
}

/* Starts a session on the board (closing any previous one) */
function openSession(L) {
  clearTransient();
  closeSheet();
  const old = state.lesson;
  if (old) { killSession(old); L.prevFlipped = old.prevFlipped; }
  else L.prevFlipped = state.flipped;
  L.id = ++sessionSeq;
  L.evals = L.evals || {};
  state.lesson = L;
  state.flipped = !!L.flip;
  render();
}

function closeLesson() {
  const L = state.lesson;
  if (!L) return;
  if (L.kind === 'bot' && !L.over && L.moves.length > 0) {
    let ok = true;
    try { ok = window.confirm('Leave this game? It will not be saved.'); } catch (err) { ok = true; }
    if (!ok) return;
  }
  killSession(L);
  clearTransient();
  state.lesson = null;
  state.flipped = L.prevFlipped;
  render();
}

/* plays a move on the live line of a session (practice, drill, bot) */
function applyTo(L, from, to, promo) {
  const ch = new Chess();
  ch.load(L.fens[L.idx]);
  const m = ch.move({ from, to, promotion: promo || undefined });
  if (!m) return null;
  L.moves.push(m);
  L.fens.push(ch.fen());
  L.idx = L.moves.length;
  state.anim = moveAnim(m, false);
  soundFor(m);
  return m;
}

function popMove(L) {
  const m = L.moves.pop();
  L.fens.pop();
  L.idx = L.moves.length;
  if (m) state.anim = moveAnim(m, true);
  return m;
}

function sessionCanMove(L) {
  if (!L || L.dead) return false;
  if (L.kind === 'practice') return L.status === 'line' && turnOf(L) === L.userColor;
  if (L.kind === 'drill') return !L.busy && !L.solved && !L.finished;
  if (L.kind === 'bot') return !L.over && !L.thinking && !L.error && turnOf(L) === L.userColor;
  return false;
}

function sessionMove(from, to, promo) {
  const L = state.lesson;
  if (!L || !sessionCanMove(L)) return false;
  if (L.kind === 'practice') return practiceMove(L, from, to, promo);
  if (L.kind === 'drill') return drillMove(L, from, to, promo);
  if (L.kind === 'bot') return botUserMove(L, from, to, promo);
  return false;
}

function boardInteractive() {
  if (state.promo || anySheetOpen()) return false;
  const L = state.lesson;
  if (L) return sessionCanMove(L);
  return !!state.game;
}

/* arrows / badges drawn by sessions */
function sessionOverlay() {
  const L = state.lesson;
  let h = '';
  const arrow = (uci) => ((uci && uci.length >= 4) ? arrowSvg(uci.slice(0, 2), uci.slice(2, 4)) : '');
  if (L.kind === 'practice') {
    if (L.hint && L.status === 'line') {
      const t = L.th.moves[L.moves.length];
      if (t) h += arrow(t.from + t.to);
    }
  } else if (L.kind === 'drill') {
    if (L.hint && !L.solved && !L.finished) h += arrow(L.def.steps[L.step].accept[0]);
  } else if (L.kind === 'bot') {
    const a = L.evals[L.fens[L.idx]];
    if (L.hint && a && a.best && sessionCanMove(L)) h += arrow(a.best);
    const k = L.lastCoach;
    if (k != null && L.coach[k] && k >= L.moves.length - 2) {
      const cl = CLS[L.coach[k].cls];
      const p = sqXY(L.moves[k].to);
      const cx = (p.x + 0.33).toFixed(3);
      const cy = (p.y - 0.33).toFixed(3);
      h += '<circle cx="' + cx + '" cy="' + cy + '" r=".21" fill="' + cl.color + '" stroke="#262421" stroke-width=".03"/>' +
        '<text x="' + cx + '" y="' + cy + '" font-size=".2" font-weight="800" fill="' + cl.fg + '" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif">' + esc(cl.sym) + '</text>';
    }
  }
  return h;
}

function sessionHeaders(L) {
  if (L.kind === 'bot') {
    const you = 'You';
    const bot = 'Bot \u00B7 ' + L.bot.name;
    return { White: L.userColor === 'w' ? you : bot, Black: L.userColor === 'b' ? you : bot };
  }
  return { White: 'White', Black: 'Black' };
}

/* ---------- engine helpers for sessions ---------- */
function quickLevel() {
  const lv = engineLevel();
  return { xDepth: lv.depth, xTime: Math.max(250, Math.round(lv.movetime * 1.5)) };
}

function sessionEval(L, fen, lv) {
  if (L.evals[fen]) return Promise.resolve(L.evals[fen]);
  L.evalP = L.evalP || {};
  if (L.evalP[fen]) return L.evalP[fen];
  const p = (async () => {
    const ok = await engine.init();
    if (!ok || L.dead) return null;
    const a = await analyzeFenQuick(fen, lv, () => L.dead || state.lesson !== L);
    if (a) L.evals[fen] = a;
    return a;
  })().catch(() => null).then((a) => { delete L.evalP[fen]; return a; });
  L.evalP[fen] = p;
  return p;
}

/* =====================================================================
   Openings: lines, study, practice
   ===================================================================== */
function lineOf(def, vi) {
  if (!vi) return { name: def.name, moves: def.moves, notes: def.notes, prefix: -1, note: def.blurb };
  const v = def.variants[vi - 1];
  const a = def.moves.split(/\s+/).filter(Boolean);
  const b = v.moves.split(/\s+/).filter(Boolean);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  const notes = b.map((_, i) => (i < p ? def.notes[i] : ((v.n && v.n[i]) || null)));
  return { name: v.name, moves: v.moves, notes, prefix: p, note: v.note };
}

function buildLesson(def, vi) {
  const line = lineOf(def, vi || 0);
  const ch = new Chess();
  const fens = [ch.fen()];
  const moves = [];
  const toks = line.moves.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const m = ch.move(toks[i], { sloppy: true });
    if (!m) { console.warn('[ChessLens] opening line stopped at', def.name, toks[i]); break; }
    moves.push(m);
    fens.push(ch.fen());
  }
  const bk = ensureBook();
  const names = [null];
  let cur = null;
  for (let i = 1; i < fens.length; i++) {
    const nm = bk.names.get(posKey(fens[i]));
    if (nm) cur = nm;
    names.push(cur);
  }
  return { kind: 'study', def, vi: vi || 0, line, fens, moves, names, notes: line.notes, prefix: line.prefix, idx: 0, flip: def.side === 'b' };
}

function startLesson(id, vi) {
  const def = OPENINGS.find((o) => o.id === id);
  if (!def) return;
  openSession(buildLesson(def, vi || 0));
}

function lessonGo(i) {
  const L = state.lesson;
  if (!L || L.kind !== 'study') return;
  const np = clamp(i, 0, L.moves.length);
  if (np === L.idx) return;
  const delta = np - L.idx;
  L.idx = np;
  if (delta === 1) {
    const m = L.moves[np - 1];
    state.anim = moveAnim(m, false);
    soundFor(m);
  } else if (delta === -1) {
    state.anim = moveAnim(L.moves[np], true);
  }
  render();
}

/* nav buttons while a session is open */
function lessonNav(dir) {
  const L = state.lesson;
  if (!L) return;
  if (L.kind === 'study') {
    if (dir === 'prev') lessonGo(L.idx - 1);
    else if (dir === 'next') lessonGo(L.idx + 1);
    else if (dir === 'first') lessonGo(0);
    else lessonGo(L.moves.length);
  } else if (L.kind === 'practice' && dir === 'prev') {
    practiceUndo(L);
  }
}

function startPractice(id, vi) {
  const def = OPENINGS.find((o) => o.id === id);
  if (!def) return;
  const th = buildLesson(def, vi || 0);
  const ch = new Chess();
  const L = {
    kind: 'practice', def, vi: vi || 0, th, fens: [ch.fen()], moves: [], idx: 0,
    userColor: def.side, flip: def.side === 'b', status: 'line', mistakes: 0, hints: 0,
    hint: false, fb: null, reply: null
  };
  openSession(L);
  if (def.side === 'b') scheduleReply(L, 500);
}

function scheduleReply(L, ms) {
  clearTimeout(L.timer);
  L.timer = setTimeout(() => {
    if (state.lesson !== L || L.dead || L.status !== 'line') return;
    const i = L.moves.length;
    const t = L.th.moves[i];
    if (!t) return;
    const m = applyTo(L, t.from, t.to, t.promotion);
    if (!m) return;
    L.reply = { san: m.san, note: L.th.notes[i] };
    if (L.moves.length >= L.th.moves.length) L.status = 'done';
    render();
  }, ms);
}

function practiceMove(L, from, to, promo) {
  const i = L.moves.length;
  const exp = L.th.moves[i];
  const fenBefore = L.fens[L.idx];
  const m = applyTo(L, from, to, promo);
  if (!m) return false;
  L.hint = false;
  L.reply = null;
  const same = !!exp && exp.from === m.from && exp.to === m.to && (exp.promotion || '') === (m.promotion || '');
  if (same) {
    L.fb = { ok: true, san: m.san, note: L.th.notes[i], name: L.th.names[i + 1] };
    if (L.moves.length >= L.th.moves.length) L.status = 'done';
    else scheduleReply(L, 550);
  } else {
    L.status = 'off';
    L.mistakes++;
    const bk = ensureBook();
    const key = posKey(L.fens[L.idx]);
    L.fb = {
      ok: false, san: m.san, exp: exp ? exp.san : null, expNote: L.th.notes[i],
      book: bk.keys.has(key) ? (bk.names.get(key) || 'another known line') : null, eng: null
    };
    explainDeviation(L, fenBefore, L.fens[L.idx]);
  }
  render();
  return true;
}

async function explainDeviation(L, fenB, fenA) {
  try {
    const q = quickLevel();
    const a0 = await sessionEval(L, fenB, q);
    const a1 = await sessionEval(L, fenA, q);
    if (!a0 || !a1 || L.dead || !L.fb || L.fb.ok) return;
    const sgn = L.userColor === 'w' ? 1 : -1;
    const loss = Math.max(0, winPct(a0.cp * sgn) - winPct(a1.cp * sgn));
    let t;
    if (loss < 4) t = 'The engine still likes this move: it is playable, just not the line you are practicing.';
    else if (loss < 10) t = 'The engine finds it slightly worse than the book move.';
    else if (loss < 20) t = 'The engine considers it a real mistake.';
    else t = 'The engine considers it a serious mistake.';
    L.fb.eng = t + ' (' + fmtEval(a1) + ')';
    if (state.lesson === L) renderCard();
  } catch (e) { /* best effort */ }
}

function practiceUndo(L) {
  if (L.moves.length === 0) return;
  clearTimeout(L.timer);
  popMove(L);
  /* after taking back, it must be the player's turn again */
  if (L.moves.length > 0 && turnOf(L) !== L.userColor) popMove(L);
  L.status = 'line';
  L.fb = null;
  L.reply = null;
  L.hint = false;
  if (L.def.side === 'b' && L.moves.length === 0) scheduleReply(L, 500);
  render();
}

function practiceShow(L) {
  const i = L.moves.length - (L.status === 'off' ? 1 : 0);
  const t = L.th.moves[i];
  if (!t) return;
  if (L.status === 'off') { popMove(L); L.status = 'line'; L.fb = null; }
  const m = applyTo(L, t.from, t.to, t.promotion);
  if (!m) return;
  L.fb = { ok: true, san: m.san, note: L.th.notes[i], name: L.th.names[i + 1], shown: true };
  if (L.moves.length >= L.th.moves.length) L.status = 'done';
  else scheduleReply(L, 550);
  render();
}

function practiceRestart(L) {
  clearTimeout(L.timer);
  const ch = new Chess();
  L.fens = [ch.fen()]; L.moves = []; L.idx = 0;
  L.status = 'line'; L.mistakes = 0; L.hints = 0; L.hint = false; L.fb = null; L.reply = null;
  render();
  if (L.def.side === 'b') scheduleReply(L, 500);
}

/* =====================================================================
   Interactive lessons (drills)
   ===================================================================== */
function startDrill(id) {
  const def = DRILLS.find((d) => d.id === id);
  if (!def) return;
  const L = { kind: 'drill', def, step: 0, fens: [], moves: [], idx: 0, userColor: 'w', flip: false, finished: false };
  loadDrillStep(L);
  openSession(L);
}

function loadDrillStep(L) {
  const st = L.def.steps[L.step];
  L.fens = [st.fen];
  L.moves = [];
  L.idx = 0;
  L.userColor = st.fen.split(' ')[1];
  L.flip = L.userColor === 'b';
  L.solved = false;
  L.tries = 0;
  L.hint = false;
  L.fb = null;
  L.busy = false;
}

function drillMove(L, from, to, promo) {
  const st = L.def.steps[L.step];
  const m = applyTo(L, from, to, promo);
  if (!m) return false;
  const uci = m.from + m.to + (m.promotion || '');
  L.hint = false;
  if (st.accept.indexOf(uci) >= 0) {
    L.solved = true;
    L.fb = { ok: true, text: st.ok };
  } else {
    L.tries++;
    L.busy = true;
    L.fb = { ok: false, text: (st.wrong && st.wrong[uci]) || 'That move is legal, but it does not reach the goal. Try again.' };
    clearTimeout(L.timer);
    L.timer = setTimeout(() => {
      if (state.lesson !== L || L.dead) return;
      popMove(L);
      L.busy = false;
      if (L.tries >= 2) L.hint = true;
      render();
    }, 1300);
  }
  render();
  return true;
}

function drillNext() {
  const L = state.lesson;
  if (!L || L.kind !== 'drill' || !L.solved) return;
  clearTimeout(L.timer);
  if (L.step + 1 >= L.def.steps.length) {
    L.finished = true;
    state.prefs.done = state.prefs.done || {};
    state.prefs.done[L.def.id] = true;
    savePrefs();
    render();
    return;
  }
  L.step++;
  loadDrillStep(L);
  state.flipped = L.flip;
  render();
}

function drillRestart(L) {
  clearTimeout(L.timer);
  L.step = 0;
  L.finished = false;
  loadDrillStep(L);
  state.flipped = L.flip;
  render();
}

/* =====================================================================
   Bot game with coach feedback
   ===================================================================== */
function startBot() {
  const bl = BOT_LEVELS.find((l) => l.id === state.prefs.botLevel) || BOT_LEVELS[1];
  let color = state.prefs.botColor;
  if (color !== 'w' && color !== 'b') color = Math.random() < 0.5 ? 'w' : 'b';
  const ch = new Chess();
  const L = {
    kind: 'bot', bot: bl, fens: [ch.fen()], moves: [], idx: 0, userColor: color, flip: color === 'b',
    over: null, thinking: false, error: false, coach: {}, lastCoach: null, coachBusy: 0, hint: false
  };
  openSession(L);
  botStep(L);
}

function botResult(L, ch) {
  if (ch.in_checkmate()) {
    const winner = ch.turn() === 'w' ? 'b' : 'w';
    return { text: winner === L.userColor ? 'Checkmate \u2014 you win!' : 'Checkmate \u2014 the bot wins.', result: winner === 'w' ? '1-0' : '0-1' };
  }
  let why = 'Draw.';
  if (ch.in_stalemate()) why = 'Stalemate \u2014 draw.';
  else if (ch.insufficient_material()) why = 'Draw by insufficient material.';
  else if (ch.in_threefold_repetition()) why = 'Draw by repetition.';
  else if (ch.in_draw()) why = 'Draw (50-move rule).';
  return { text: why, result: '1/2-1/2' };
}

async function botStep(L) {
  if (L.dead || state.lesson !== L) return;
  const ch = new Chess();
  ch.load(L.fens[L.idx]);
  if (ch.game_over()) {
    L.over = botResult(L, ch);
    L.thinking = false;
    render();
    return;
  }
  if (ch.turn() === L.userColor) {
    /* the player's turn: keep the evaluation bar (and hint) up to date */
    sessionEval(L, L.fens[L.idx], quickLevel()).then(() => {
      if (state.lesson === L && !L.dead) { renderEval(); renderOverlay(); renderCard(); }
    });
    render();
    return;
  }
  L.thinking = true;
  render();
  const ok = await engine.init();
  if (L.dead || state.lesson !== L) return;
  if (!ok) { L.error = true; L.thinking = false; render(); return; }
  const t0 = Date.now();
  let res = null;
  try { res = await engine.analyze(L.fens[L.idx], L.bot.depth, 1, L.bot.time, () => L.dead || state.lesson !== L, L.bot.skill); }
  catch (e) { res = null; }
  if (L.dead || state.lesson !== L) return;
  const wait = 450 - (Date.now() - t0);
  if (wait > 0) await sleep(wait);   /* a short human-like pause */
  if (L.dead || state.lesson !== L) return;
  L.thinking = false;
  let m = null;
  const u = res && res.best && res.best !== '(none)' ? uciToMove(res.best) : null;
  if (u) m = applyTo(L, u.from, u.to, u.promotion);
  if (!m) {
    const list = ch.moves({ verbose: true });
    if (list.length) { const r = list[Math.floor(Math.random() * list.length)]; m = applyTo(L, r.from, r.to, r.promotion); }
  }
  L.hint = false;
  render();
  botStep(L);
}

function botUserMove(L, from, to, promo) {
  const k = L.moves.length;
  const fenBefore = L.fens[L.idx];
  const prev = k > 0 ? L.moves[k - 1] : null;
  const m = applyTo(L, from, to, promo);
  if (!m) return false;
  L.hint = false;
  render();
  botStep(L);                                  /* the bot answers first... */
  coachJob(L, { k, fenBefore, fenAfter: L.fens[L.idx], move: m, prev });   /* ...the coach checks in the background */
  return true;
}

async function coachJob(L, p) {
  L.coachBusy++;
  if (state.lesson === L) renderCard();
  try {
    const q = quickLevel();
    const a0 = await sessionEval(L, p.fenBefore, q);
    const a1 = await sessionEval(L, p.fenAfter, q);
    if (a0 && a1 && !L.dead) {
      L.coach[p.k] = liveClassify(L, p, a0, a1);
      L.lastCoach = p.k;
    }
  } catch (e) { console.warn('[ChessLens] coach failed', e); }
  L.coachBusy--;
  if (state.lesson === L && !L.dead) { renderEval(); renderOverlay(); renderCard(); }
}

/* Same thresholds as the game analysis, but self-contained for a live game */
function liveClassify(L, p, A, B) {
  const mv = p.move;
  const k = p.k;
  const sgn = mv.color === 'w' ? 1 : -1;
  const winBefore = winPct(A.cp * sgn);
  const winAfter = winPct(B.cp * sgn);
  const uci = mv.from + mv.to + (mv.promotion || '');
  const isBest = !!A.best && uci === A.best;

  let bestSan = null;
  let bestMove = null;
  if (A.best) {
    const c0 = new Chess();
    c0.load(p.fenBefore);
    const bm = c0.move(uciToMove(A.best));
    if (bm) { bestSan = bm.san; bestMove = bm; }
  }

  const bk = ensureBook();
  let allBook = k < BOOK_MAX_PLIES;
  let opening = null;
  for (let j = 1; j <= k + 1 && allBook; j++) {
    const key = posKey(L.fens[j]);
    if (!bk.keys.has(key)) allBook = false;
    else if (bk.names.has(key)) opening = bk.names.get(key);
  }

  const after = new Chess();
  after.load(p.fenAfter);
  let cls;
  let loss = 0;
  let sac = false;
  let tactical = false;
  if (allBook) {
    cls = 'book';
  } else {
    const gain = (mv.captured ? VAL[mv.captured] : 0) + (mv.promotion ? VAL[mv.promotion] - 1 : 0);
    const risk = after.game_over() ? 0 : bestCapture(after).net;
    sac = (gain - risk) <= -2;
    const mateMineAfter = B.mate != null && B.mate !== 0 && Math.sign(B.mate) === sgn && Math.abs(B.mate) <= 6;
    const mateTheirsAfter = B.mate != null && B.mate !== 0 && Math.sign(B.mate) === -sgn;
    loss = isBest ? 0 : Math.max(0, winBefore - winAfter);
    const inaccCutoff = k < 6 ? 8 : 5;
    if (isBest || loss <= 0.4) cls = 'best';
    else if (loss < inaccCutoff) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';
    const original = cls;
    if (CLS_RANK[cls] >= 2 && !mateTheirsAfter) {
      if (winBefore >= 93 && winAfter >= 75) cls = capCls(cls, 'good');
      if (mateMineAfter) cls = capCls(cls, 'good');
      else if (winAfter >= 90) cls = capCls(cls, 'good');
      else if (winAfter >= 80) cls = capCls(cls, 'inaccuracy');
      if (sac && winAfter >= 60) cls = capCls(cls, 'inaccuracy');
    }
    tactical = cls !== original;
    if ((cls === 'best' || cls === 'good') && sac && loss <= 1.5 && (mateMineAfter || winAfter >= 55) &&
        winAfter >= winBefore - 3 && (winBefore <= 85 || mateMineAfter)) cls = 'brilliant';
  }

  const R = { cls, loss, winBefore, winAfter, isBest, sac, tactical, bestSan, bestMove, opening: allBook ? opening : null };
  try {
    R.comment = generateCommentary({
      index: k, move: mv, color: mv.color, prev: p.prev, cls, loss, winBefore, winAfter, isBest, sac, tactical,
      bestSan, bestMove, bestUci: A.best, opening: R.opening, evalBefore: A, evalAfter: B,
      fenBefore: p.fenBefore, fenAfter: p.fenAfter, after,
      isMate: after.in_checkmate(), isDraw: after.game_over() && !after.in_checkmate(), inCheck: after.in_check()
    });
  } catch (e) {
    R.comment = mv.san + ' \u2014 ' + CLS[cls].label + '.';
  }
  return R;
}

function botResign(L) {
  if (L.over || L.dead) return;
  let ok = true;
  try { ok = window.confirm('Resign this game?'); } catch (err) { ok = true; }
  if (!ok) return;
  clearTimeout(L.timer);
  L.thinking = false;
  L.over = { text: 'You resigned.', result: L.userColor === 'w' ? '0-1' : '1-0' };
  render();
}

function botPgn(L) {
  const you = state.username || 'You';
  const botName = 'ChessLens Bot (' + L.bot.name + ')';
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const res = L.over ? L.over.result : '*';
  const head = [
    '[Event "ChessLens bot game"]', '[Site "ChessLens"]',
    '[Date "' + d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + '"]',
    '[White "' + (L.userColor === 'w' ? you : botName) + '"]',
    '[Black "' + (L.userColor === 'b' ? you : botName) + '"]',
    '[Result "' + res + '"]'
  ];
  let body = '';
  L.moves.forEach((m, i) => {
    if (i % 2 === 0) body += (Math.floor(i / 2) + 1) + '. ';
    body += m.san + ' ';
  });
  return head.join('\n') + '\n\n' + body + res;
}

function botReview(L) {
  if (!L.moves.length) return;
  const pgn = botPgn(L);
  killSession(L);
  const color = L.userColor;
  const r = loadGame(pgn, { myColor: color });
  if (r.error) { state.lesson = null; render(); return; }
  addToLibrary(pgn, state.game, { src: 'bot' });
  openReport();
}

function botSummaryHtml(L) {
  const ks = Object.keys(L.coach);
  if (!ks.length) return '';
  const counts = {};
  let acc = 0;
  ks.forEach((k) => {
    const R = L.coach[k];
    counts[R.cls] = (counts[R.cls] || 0) + 1;
    acc += clamp(103.1668 * Math.exp(-0.04354 * (R.loss || 0)) - 3.1669, 0, 100);
  });
  const chips = CLS_ORDER.filter((c) => counts[c]).map((c) =>
    '<span class="sum-chip"><i style="background:' + CLS[c].color + ';color:' + CLS[c].fg + '">' + esc(CLS[c].sym) + '</i>' + counts[c] + '</span>').join('');
  return '<div class="fb coach"><div class="fb-head"><b>Your game</b><span class="muted">accuracy ' + Math.round(acc / ks.length) + '%</span></div>' +
    '<div class="sum-chips">' + chips + '</div></div>';
}

/* =====================================================================
   Learn / Play UI (inside the sheet)
   ===================================================================== */
function lineSan(def, vi) {
  try {
    const th = buildLesson(def, vi);
    return sanLine(START_FEN, th.moves.map((m) => m.san));
  } catch (e) { return ''; }
}

function openingDetailHtml(o) {
  let h = '<div class="gl-head"><button class="btn ghost small" data-learn-back>\u2190 All openings</button></div>';
  h += '<h3 class="od-title">' + esc(o.name) + ' <span class="gres lside">' + (o.side === 'w' ? 'White' : 'Black') + '</span></h3>';
  h += '<p class="od-p"><b>The idea.</b> ' + esc(o.idea) + '</p>';
  h += '<h4 class="od-h">Typical threats &amp; tricks</h4><ul class="od-list">' + o.threats.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  h += '<h4 class="od-h">Lines</h4>';
  for (let vi = 0; vi <= o.variants.length; vi++) {
    const ln = lineOf(o, vi);
    h += '<div class="od-line"><b>' + esc(vi === 0 ? 'Main line \u00B7 ' + ln.name : ln.name) + '</b><small>' + esc(vi === 0 ? 'The classic setup, move by move.' : ln.note) + '</small>' +
      '<code>' + esc(lineSan(o, vi)) + '</code>' +
      '<div class="row gap"><button class="btn ghost small grow" data-study="' + o.id + ':' + vi + '">Study</button>' +
      '<button class="btn primary small grow" data-practice="' + o.id + ':' + vi + '">Practice</button></div></div>';
  }
  return h;
}

function renderLearnTab() {
  const sub = state.learnSub;
  document.querySelectorAll('[data-learnsub]').forEach((b) => {
    const on = b.dataset.learnsub === sub;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const so = $('#learn-openings');
  const sl = $('#learn-lessons');
  if (!so || !sl) return;
  so.hidden = sub !== 'openings';
  sl.hidden = sub !== 'lessons';
  const det = state.learnOpening ? OPENINGS.find((o) => o.id === state.learnOpening) : null;
  $('#learn-list').hidden = !!det;
  $('#learn-detail').hidden = !det;
  if (det) {
    $('#learn-detail').innerHTML = openingDetailHtml(det);
  } else {
    $('#learn-list').innerHTML = OPENINGS.map((o) =>
      '<button class="game lesson-item" data-opening="' + esc(o.id) + '">' +
      '<span class="gcol ' + o.side + '"></span>' +
      '<span class="gmain"><b>' + esc(o.name) + '</b><small>' + esc(o.blurb) + '</small></span>' +
      '<span class="gres lside">' + (o.side === 'w' ? 'White' : 'Black') + '</span></button>'
    ).join('');
  }
  const done = state.prefs.done || {};
  $('#drill-list').innerHTML = DRILLS.map((d) =>
    '<button class="game lesson-item" data-drill="' + esc(d.id) + '">' +
    '<span class="gcol n"></span>' +
    '<span class="gmain"><b>' + esc(d.name) + (done[d.id] ? ' <span class="chk-done">\u2713</span>' : '') + '</b><small>' + esc(d.blurb) + '</small></span>' +
    '<span class="gres lside">' + d.steps.length + (d.steps.length === 1 ? ' step' : ' steps') + '</span></button>'
  ).join('');
}

function renderPlayTab() {
  const c = $('#bot-colors');
  const l = $('#bot-levels');
  if (!c || !l) return;
  c.innerHTML = [['w', 'White'], ['b', 'Black'], ['r', 'Random']].map((x) =>
    '<button class="opt" data-bot-color="' + x[0] + '" aria-pressed="' + (state.prefs.botColor === x[0]) + '"><span>' + x[1] + '</span></button>').join('');
  l.innerHTML = BOT_LEVELS.map((x) =>
    '<button class="opt" data-bot-level="' + x.id + '" aria-pressed="' + (state.prefs.botLevel === x.id) + '"><span>' + esc(x.name) + '</span><small>' + esc(x.desc) + '</small></button>').join('');
}

/* ---------- card buttons ---------- */
function cardAction(t) {
  const L = state.lesson;
  const is = (sel) => !!t.closest(sel);
  if (is('[data-lesson-restart]')) { lessonGo(0); return; }
  if (is('[data-open-lessons]')) { state.learnSub = 'lessons'; state.learnOpening = null; openSheet('learn'); return; }
  if (is('[data-bot-new]')) { openSheet('play'); return; }
  if (!L) return;
  if (is('[data-study-practice]')) { startPractice(L.def.id, L.vi); return; }
  if (is('[data-practice-hint]')) { L.hint = true; L.hints++; renderOverlay(); renderCard(); return; }
  if (is('[data-practice-undo]')) { practiceUndo(L); return; }
  if (is('[data-practice-show]')) { practiceShow(L); return; }
  if (is('[data-practice-restart]')) { practiceRestart(L); return; }
  if (is('[data-practice-study]')) { startLesson(L.def.id, L.vi); return; }
  if (is('[data-drill-hint]')) { L.hint = true; renderOverlay(); renderCard(); return; }
  if (is('[data-drill-next]')) { drillNext(); return; }
  if (is('[data-drill-restart]')) { drillRestart(L); return; }
  if (is('[data-bot-hint]')) {
    L.hint = true;
    sessionEval(L, L.fens[L.idx], quickLevel()).then(() => { if (state.lesson === L) { renderOverlay(); renderCard(); } });
    renderOverlay();
    return;
  }
  if (is('[data-bot-resign]')) { botResign(L); return; }
  if (is('[data-bot-review]')) { botReview(L); }
}

/* ---------- cards + mode bar ---------- */
function exploreCardHtml() {
  const ex = state.explore;
  const g = state.game;
  const fen = ex.fens[ex.idx];
  const a = ex.evals[fen] || null;
  const mv = ex.idx > 0 ? ex.moves[ex.idx - 1] : null;
  let h = '<div class="card-head"><div class="badge-lg whatif">?</div><div class="card-title">' +
    (mv ? esc(mv.san) : 'Starting point') +
    '<small style="color:#ffb02e">What if \u2014 exploring a different line</small></div>' +
    (a ? '<div class="chip-eval' + (a.cp < 0 ? ' neg' : '') + '">' + esc(fmtEval(a)) + '</div>' : '') + '</div>';

  if (ex.error) {
    h += '<p class="note">The engine could not be loaded, so this line can\u2019t be evaluated right now.</p>';
  } else if (!a) {
    h += '<p class="card-text"><span class="spin"></span>Evaluating this position\u2026</p>';
  } else if (a.mate === 0) {
    h += '<p class="card-text">Checkmate.</p>';
  } else if (!a.best) {
    h += '<p class="card-text">The game is drawn here.</p>';
  } else {
    const ch = new Chess();
    ch.load(fen);
    const sans = pvToSan(fen, a.pv && a.pv.length ? a.pv : [a.best], 4);
    h += '<p class="card-text">' + esc(evalSentence(a)) + '</p>';
    if (sans.length) {
      h += '<div class="hint"><span class="swatch"></span>' + (ch.turn() === 'w' ? 'White' : 'Black') +
        '\u2019s best reply: <b>' + esc(sans[0]) + '</b>' +
        (sans.length > 1 ? ' <span class="muted">(' + esc(sans.join(' ')) + ')</span>' : '') + '</div>';
    }
  }

  if (g && ex.basePly < g.moves.length && ex.idx >= 1) {
    const gm = g.moves[ex.basePly];
    const ga = state.analysis[ex.basePly + 1];
    h += '<div class="hint">In the game: <b>' + esc(gm.san) + '</b>' +
      (ga ? ' <span class="muted">(' + esc(fmtEval(ga)) + ')</span>' : '') + '</div>';
  }
  h += '<p class="tip">Drag or tap pieces to keep exploring \u00B7 use &lt; &gt; to step through your line.</p>';
  h += '<button class="btn primary wide" data-back-game>Back to the game</button>';
  return h;
}

function lessonCardHtml() {
  const L = state.lesson;
  if (L.kind === 'practice') return practiceCardHtml(L);
  if (L.kind === 'drill') return drillCardHtml(L);
  if (L.kind === 'bot') return botCardHtml(L);
  return studyCardHtml(L);
}

function progressBar(frac) {
  return '<div class="bar lbar"><i style="width:' + Math.round(clamp(frac, 0, 1) * 100) + '%"></i></div>';
}

function studyCardHtml(L) {
  const def = L.def;
  const total = L.moves.length;
  const i = L.idx;
  const sideName = def.side === 'w' ? 'White' : 'Black';
  let h = '';
  if (i === 0) {
    h += '<div class="card-head"><div class="badge-lg lesson">\u265E' + TEXT_VS + '</div><div class="card-title">' + esc(def.name) +
      '<small style="color:var(--accent)">' + esc(L.vi ? L.line.name : 'Main line') + ' \u00B7 you play ' + sideName + '</small></div></div>';
    h += '<p class="card-text"><b>The idea.</b> ' + esc(def.idea) + '</p>';
    h += '<p class="tip" style="margin-top:8px"><b>Watch out for:</b> ' + esc(def.threats[0]) + '</p>';
    h += '<p class="card-text" style="margin-top:8px">Press <b>&gt;</b> to play through the line one move at a time (' + total + ' moves).</p>';
  } else {
    const m = L.moves[i - 1];
    const num = Math.ceil(i / 2);
    const white = m.color === 'w';
    h += '<div class="card-head"><div class="badge-lg lesson">' + num + '</div><div class="card-title">' + esc(m.san) +
      '<small style="color:var(--muted)">Move ' + num + (white ? '' : '\u2026') + ' \u00B7 ' + (white ? 'White' : 'Black') + '</small></div></div>';
    h += '<p class="card-text">' + esc((L.notes && L.notes[i - 1]) ||
      describeMove({ move: m, prev: i > 1 ? L.moves[i - 2] : null, color: m.color })) + '</p>';
    if (L.vi && L.prefix >= 0 && i - 1 === L.prefix) {
      h += '<p class="note" style="color:#ffb02e">Variation starts here: ' + esc(L.line.name) + '.</p>';
    }
    const nm = L.names[i];
    if (nm) {
      h += '<div class="hint"><span class="swatch" style="background:' + CLS.book.color + '"></span>Opening: <b style="color:#d2a679">' + esc(nm) + '</b></div>';
    }
  }
  h += progressBar(i / Math.max(1, total));
  if (i === total) {
    h += '<p class="note" style="color:#d2a679">Line complete \u2014 from here the game branches into many plans. Now try to play it yourself.</p>' +
      '<div class="btnrow"><button class="btn primary" data-study-practice>Practice this line</button>' +
      '<button class="btn ghost" data-lesson-restart>Replay</button></div>';
  }
  return h;
}

function practiceCardHtml(L) {
  const total = L.th.moves.length;
  const you = L.userColor === 'w' ? 'White' : 'Black';
  const n = L.moves.length;
  let h = '<div class="card-head"><div class="badge-lg lesson">\u265E' + TEXT_VS + '</div><div class="card-title">Practice: ' + esc(L.def.name) +
    '<small style="color:var(--accent)">' + esc(L.vi ? L.th.line.name : 'Main line') + ' \u00B7 you play ' + you + '</small></div></div>';

  if (n === 0) {
    h += '<p class="card-text">Play the theory moves for ' + you + ' on the board. I check every move against this line and explain why if you leave it.</p>';
  }
  const fb = L.fb;
  if (fb && fb.ok) {
    h += '<div class="fb ok"><b>\u2713 ' + esc(fb.san) + '</b> \u2014 ' + (fb.shown ? 'the theory move.' : 'in theory!') +
      (fb.name ? ' <span class="muted">(' + esc(fb.name) + ')</span>' : '') + (fb.note ? '<p>' + esc(fb.note) + '</p>' : '') + '</div>';
  } else if (fb) {
    h += '<div class="fb bad"><b>' + esc(fb.san) + '</b> \u2014 you left the line.';
    h += '<p>' + (fb.book
      ? 'It is also a known book move (' + esc(fb.book) + '), but it is not the line you are practicing.'
      : 'It is not a known theory move in this position.') + '</p>';
    if (fb.exp) h += '<p>The line continues with <b>' + esc(fb.exp) + '</b>' + (fb.expNote ? ': ' + esc(fb.expNote) : '.') + '</p>';
    if (fb.eng) h += '<p class="muted">' + esc(fb.eng) + '</p>';
    h += '</div>';
  }
  if (L.reply && L.status !== 'off') {
    h += '<p class="card-text" style="margin-top:10px">Reply: <b>' + esc(L.reply.san) + '</b>' + (L.reply.note ? ' \u2014 ' + esc(L.reply.note) : '') + '</p>';
  }
  h += progressBar(n / Math.max(1, total));

  if (L.status === 'done') {
    h += '<p class="note" style="color:#d2a679">Line complete! Mistakes: ' + L.mistakes + ' \u00B7 hints: ' + L.hints + '.</p>' +
      '<div class="btnrow"><button class="btn primary" data-practice-restart>Practice again</button>' +
      '<button class="btn ghost" data-practice-study>Study the line</button></div>';
  } else if (L.status === 'off') {
    h += '<div class="btnrow"><button class="btn primary" data-practice-undo>Take back</button>' +
      '<button class="btn ghost" data-practice-show>Show the line move</button></div>';
  } else {
    h += '<div class="btnrow"><button class="btn ghost" data-practice-hint>Hint</button>' +
      (n > 0 ? '<button class="btn ghost" data-practice-undo>Take back</button>' : '') + '</div>';
  }
  return h;
}

function drillCardHtml(L) {
  const def = L.def;
  const total = def.steps.length;
  if (L.finished) {
    return '<div class="card-head"><div class="badge-lg lesson">\u2713</div><div class="card-title">' + esc(def.name) +
      '<small style="color:var(--accent)">Lesson complete</small></div></div>' +
      '<p class="card-text">You finished all ' + total + ' steps. ' + esc(def.goal) + '</p>' +
      '<div class="btnrow"><button class="btn primary" data-open-lessons>More lessons</button>' +
      '<button class="btn ghost" data-drill-restart>Replay</button></div>';
  }
  const st = def.steps[L.step];
  const side = L.userColor === 'w' ? 'White' : 'Black';
  let h = '<div class="card-head"><div class="badge-lg lesson">' + (L.step + 1) + '</div><div class="card-title">' + esc(st.name || ('Step ' + (L.step + 1))) +
    '<small style="color:var(--muted)">' + esc(def.name) + ' \u00B7 step ' + (L.step + 1) + ' of ' + total + ' \u00B7 ' + side + ' to move</small></div></div>';
  h += '<p class="card-text">' + esc(st.task) + '</p>';
  if (L.step === 0 && !L.fb && L.moves.length === 0) h += '<p class="tip"><b>Goal.</b> ' + esc(def.goal) + '</p>';
  if (L.fb) h += '<div class="fb ' + (L.fb.ok ? 'ok' : 'bad') + '">' + (L.fb.ok ? '<b>\u2713 </b>' : '') + esc(L.fb.text) + '</div>';
  if (L.hint && !L.solved && st.hint) h += '<p class="note">Hint: ' + esc(st.hint) + '</p>';
  h += progressBar((L.step + (L.solved ? 1 : 0)) / total);
  if (L.solved) {
    h += '<div class="btnrow"><button class="btn primary" data-drill-next>' + (L.step + 1 >= total ? 'Finish' : 'Next step') + '</button></div>';
  } else {
    h += '<div class="btnrow"><button class="btn ghost" data-drill-hint>Hint</button></div>';
  }
  return h;
}

function botCardHtml(L) {
  const you = L.userColor === 'w' ? 'White' : 'Black';
  const a = L.evals[L.fens[L.idx]] || null;
  let h = '<div class="card-head"><div class="badge-lg bot">\u265F' + TEXT_VS + '</div><div class="card-title">vs Bot \u00B7 ' + esc(L.bot.name) +
    '<small style="color:var(--muted)">You play ' + you + ' \u00B7 coach on</small></div>' +
    (a ? '<div class="chip-eval' + (a.cp < 0 ? ' neg' : '') + '">' + esc(fmtEval(a)) + '</div>' : '') + '</div>';

  if (L.error) {
    h += '<p class="note">The engine could not be loaded, so the bot cannot play. It downloads once (internet needed) and is then cached for offline use.</p>';
  } else if (L.over) {
    h += '<p class="card-text"><b>' + esc(L.over.text) + '</b></p>';
  } else if (L.thinking) {
    h += '<p class="card-text"><span class="spin"></span>Bot is thinking\u2026</p>';
  } else {
    h += '<p class="card-text">' + (L.moves.length ? 'Your move.' : 'Make the first move.') + '</p>';
  }

  const k = L.lastCoach;
  if (k != null && L.coach[k]) {
    const R = L.coach[k];
    const cl = CLS[R.cls];
    h += '<div class="fb coach"><div class="fb-head"><i style="background:' + cl.color + ';color:' + cl.fg + '">' + esc(cl.sym) + '</i><b>' +
      esc(L.moves[k].san) + '</b><span style="color:' + cl.color + '">' + cl.label + '</span></div><p>' + esc(R.comment) + '</p></div>';
  }
  if (L.coachBusy > 0) h += '<p class="note" style="color:var(--muted)"><span class="spin"></span>Coach is checking your move\u2026</p>';

  if (L.over) {
    h += botSummaryHtml(L);
    h += '<div class="btnrow">' + (L.moves.length ? '<button class="btn primary" data-bot-review>Review game</button>' : '') +
      '<button class="btn ghost" data-bot-new>New game</button></div>';
  } else {
    h += '<div class="btnrow"><button class="btn ghost" data-bot-hint>Hint</button><button class="btn ghost" data-bot-resign>Resign</button></div>';
  }
  if (L.moves.length) {
    const s = Math.max(0, L.moves.length - 8);
    h += '<p class="tip">' + (s > 0 ? '\u2026 ' : '') + esc(sanLine(L.fens[s], L.moves.slice(s).map((m) => m.san))) + '</p>';
  }
  return h;
}

function renderModeBar() {
  const bar = $('#explore-bar');
  if (!bar) return;
  const L = state.lesson;
  const ex = state.explore;
  const mv = $('#moves');
  if (mv) mv.hidden = !!L;
  bar.hidden = !(L || ex);
  if (!L && !ex) return;
  bar.classList.toggle('lesson', !!L);
  let badge = 'What if';
  let line = '';
  if (L) {
    if (L.kind === 'study') { badge = 'Learn'; line = L.def.name + ' \u00B7 ' + L.idx + '/' + L.moves.length; }
    else if (L.kind === 'practice') { badge = 'Practice'; line = L.def.name + ' \u00B7 ' + (L.vi ? L.th.line.name : 'Main line'); }
    else if (L.kind === 'drill') { badge = 'Lesson'; line = L.def.name + (L.finished ? '' : ' \u00B7 step ' + (L.step + 1) + '/' + L.def.steps.length); }
    else { badge = 'Play'; line = 'vs Bot \u00B7 ' + L.bot.name; }
  } else {
    line = ex.moves.length ? sanLine(ex.fens[0], ex.moves.map((m) => m.san)) : 'Exploring a different line';
  }
  $('#mode-badge').textContent = badge;
  $('#mode-line').textContent = line;
  $('#btn-back-game').hidden = !!L;
  const cb = $('#btn-close-lesson');
  cb.hidden = !L;
  cb.textContent = (L && L.kind === 'bot' && !L.over) ? 'Leave game' : 'Close';
}

async function waitForChess() {
  for (let i = 0; i < 120; i++) {
    if (typeof Chess === 'function') return true;
    await sleep(100);
  }
  return false;
}

function wireEvents() {
  $('#btn-brand').addEventListener('click', () => openSheet());
  $('#btn-import').addEventListener('click', () => openSheet('import'));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-flip').addEventListener('click', () => { state.flipped = !state.flipped; render(); });
  $('#btn-first').addEventListener('click', navFirst);
  $('#btn-prev').addEventListener('click', navPrev);
  $('#btn-next').addEventListener('click', navNext);
  $('#btn-last').addEventListener('click', navLast);

  $('#moves').addEventListener('click', (e) => {
    const b = e.target.closest('.mv');
    if (b) goTo(parseInt(b.dataset.ply, 10));
  });
  $('#card').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-import]')) openSheet('import');
    else if (e.target.closest('[data-open-learn]')) openSheet('learn');
    else if (e.target.closest('[data-back-game]')) exitExplore();
    else cardAction(e.target);
  });
  $('#btn-back-game').addEventListener('click', exitExplore);
  $('#btn-close-lesson').addEventListener('click', closeLesson);
  $('#tab-learn').addEventListener('click', (e) => {
    const t = e.target;
    const sub = t.closest('[data-learnsub]');
    if (sub) { state.learnSub = sub.dataset.learnsub; renderLearnTab(); return; }
    const op = t.closest('[data-opening]');
    if (op) { state.learnOpening = op.dataset.opening; renderLearnTab(); return; }
    if (t.closest('[data-learn-back]')) { state.learnOpening = null; renderLearnTab(); return; }
    const st = t.closest('[data-study]');
    if (st) { const p = st.dataset.study.split(':'); startLesson(p[0], +p[1]); return; }
    const pr = t.closest('[data-practice]');
    if (pr) { const p = pr.dataset.practice.split(':'); startPractice(p[0], +p[1]); return; }
    const dr = t.closest('[data-drill]');
    if (dr) startDrill(dr.dataset.drill);
  });
  $('#tab-play').addEventListener('click', (e) => {
    const c = e.target.closest('[data-bot-color]');
    if (c) { state.prefs.botColor = c.dataset.botColor; savePrefs(); renderPlayTab(); return; }
    const l = e.target.closest('[data-bot-level]');
    if (l) { state.prefs.botLevel = l.dataset.botLevel; savePrefs(); renderPlayTab(); return; }
    if (e.target.closest('#btn-start-bot')) startBot();
  });

  /* What-if: tap-tap or drag a piece on the board */
  const bb = $('#board-box');
  bb.addEventListener('pointerdown', onBoardDown);
  bb.addEventListener('pointermove', onBoardMove);
  bb.addEventListener('pointerup', (e) => endDrag(e, false));
  bb.addEventListener('pointercancel', (e) => endDrag(e, true));
  bb.addEventListener('lostpointercapture', (e) => { if (state.drag) endDrag(e, true); });
  bb.addEventListener('click', (e) => {
    if (!state.promo) return;
    const b = e.target.closest('[data-promo]');
    if (b) {
      const p = state.promo;
      closePromo();
      commitMove(p.from, p.to, b.dataset.promo);
      return;
    }
    if (e.target.closest('#promo')) { closePromo(); state.sel = null; renderBoard(); }
  });

  /* browsers only allow audio after a user gesture: prepare the audio context on the first tap */
  document.addEventListener('pointerdown', () => { if (state.prefs.sound) sfx.ensure(); }, { once: true });

  /* advantage graph (board view) + summary shortcut */
  bindGraph($('#graph'), (p) => goTo(p));
  $('#btn-open-report').addEventListener('click', () => openReport(state.ply > 0 ? state.ply : null));

  /* import / games sheet */
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#btn-load-games').addEventListener('click', () => onLoadGames({ goto: true }));
  $('#in-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLoadGames({ goto: true }); });
  $('#btn-refresh-games').addEventListener('click', onRefreshGames);
  $('#user-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    setActiveProfile(b.dataset.chip);
    onLoadGames({ goto: true });
  });
  $('#glist').addEventListener('click', (e) => {
    const b = e.target.closest('.game');
    if (b) onPickGame(parseInt(b.dataset.i, 10));
  });
  $('#lib-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-lib-del]');
    if (del) { removeFromLibrary(del.dataset.libDel); return; }
    const b = e.target.closest('[data-lib]');
    if (b) onPickLib(b.dataset.lib);
  });
  $('#btn-clear-lib').addEventListener('click', () => {
    if (!state.library.length) return;
    let ok = true;
    try { ok = window.confirm('Remove all saved games from this device?'); } catch (err) { ok = true; }
    if (!ok) return;
    state.library = [];
    saveLibrary();
    renderGamesTab();
  });
  $('#btn-load-pgn').addEventListener('click', onLoadPgn);
  $('#btn-sample').addEventListener('click', onLoadSample);

  /* summary (report) sheet */
  $('#report').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  bindGraph($('#report-graph'), (p) => selectRep(p));
  $('#report-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ply]');
    if (b) selectRep(parseInt(b.dataset.ply, 10));
  });
  $('#btn-view-board').addEventListener('click', onViewBoard);

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
    const en = e.target.closest('[data-engine-id]');
    if (en) { setEngineLevel(en.dataset.engineId); return; }
    const sd = e.target.closest('[data-sound-id]');
    if (sd) { setSound(sd.dataset.soundId === 'on'); return; }
    const bt = e.target.closest('[data-board-id]');
    if (bt) { setPref('board', bt.dataset.boardId); return; }
    const pc = e.target.closest('[data-piece-id]');
    if (pc) { setPref('pieces', pc.dataset.pieceId); }
  });
  $('#btn-add-profile').addEventListener('click', onAddProfile);
  $('#in-profile').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAddProfile(); });

  document.addEventListener('keydown', (e) => {
    if (anySheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') navPrev();
    else if (e.key === 'ArrowRight') navNext();
    else if (e.key === 'Home') navFirst();
    else if (e.key === 'End') navLast();
    else if (e.key === 'Escape') { if (state.lesson) closeLesson(); else exitExplore(); }
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
  migrateStorage();
  loadPrefs();
  applyPrefs();
  loadProfiles();
  loadLibrary();
  wireEvents();

  if (!(await waitForChess())) {
    $('#card').innerHTML = '<div class="empty"><h2>Couldn\u2019t load chess.js</h2><p>The chess library is downloaded once and then cached. Connect to the internet and reload the app.</p></div>';
    return;
  }

  const saved = lsGet(LS_PGN) || lsGet(LEGACY_PGN_V9) || lsGet(LEGACY_PGN_V8) || lsGet(LEGACY_PGN_V7) || lsGet(LEGACY_PGN_V6) || lsGet(LEGACY_PGN);
  let restored = false;
  if (saved) restored = !!loadGame(saved, {}).ok;
  cleanupLegacyStorage();
  if (!restored) {
    render();
    openSheet(hasGames() ? 'games' : 'import');
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
