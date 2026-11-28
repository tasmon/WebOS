// WebOS — Tetris: keyboard and touch controls, ghost piece, hold, next queue, levels and a saved best score.
import { h, ico } from './ui.js';

const W = 10;
const H = 20;
const COLORS = { I: '#22d3ee', O: '#fbbf24', T: '#a855f7', S: '#4ade80', Z: '#f87171', J: '#60a5fa', L: '#fb923c' };
// each piece: list of 4 rotations, each a list of [x, y] cells
const SHAPES = {
  I: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[1, 0], [1, 1], [1, 2], [1, 3]]],
  O: [[[1, 0], [2, 0], [1, 1], [2, 1]]],
  T: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],
  S: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]],
  Z: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]],
  J: [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]]],
  L: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]],
};
const KEYS = Object.keys(SHAPES);
const POINTS = [0, 100, 300, 500, 800];
const BEST_KEY = 'webos.tetris.best';

function cellsOf(p) {
  const rots = SHAPES[p.t];
  return rots[p.r % rots.length].map(([x, y]) => [x + p.x, y + p.y]);
}

export function buildTetris() {
  const root = h('div', { class: 'tt', tabindex: '0' });
  let board, piece, queue, hold, canHold, score, lines, level, over, paused, started, best;
  let bag = [];
  let dropAt = 0;
  let lockAt = 0;
  let lockMoves = 0;
  let clearing = null; // { rows, until }
  let raf = 0;
  let last = 0;
  let cell = 24;
  let destroyed = false;

  try {
    best = +localStorage.getItem(BEST_KEY) || 0;
  } catch {
    best = 0;
  }

  /* --------------------------------------------------------------- DOM */
  const canvas = h('canvas', { class: 'tt-canvas' });
  const ctx = canvas.getContext('2d');
  const nextC = h('canvas', { class: 'tt-mini' });
  const holdC = h('canvas', { class: 'tt-mini' });
  const stat = (label) => {
    const v = h('b', null, '0');
    return { v, el: h('div', { class: 'tt-stat' }, h('span', null, label), v) };
  };
  const sScore = stat('Score');
  const sLines = stat('Lines');
  const sLevel = stat('Level');
  const sBest = stat('Best');
  const side = h('div', { class: 'tt-side' }, h('div', { class: 'tt-box' }, h('span', null, 'Hold'), holdC), h('div', { class: 'tt-box' }, h('span', null, 'Next'), nextC), h('div', { class: 'tt-stats' }, sScore.el, sLines.el, sLevel.el, sBest.el));
  const overlay = h('div', { class: 'tt-over', hidden: false });
  const wrap = h('div', { class: 'tt-boardwrap' }, canvas, overlay);
  const holdBtn = (icon, label, fn, rep) => {
    const b = h('button', { class: 'tt-btn', type: 'button', 'aria-label': label, title: label }, ico(icon, 24));
    let t, iv;
    const stop = () => (clearTimeout(t), clearInterval(iv));
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      if (rep) {
        t = setTimeout(() => (iv = setInterval(fn, 70)), 220);
      }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
    return b;
  };
  const pad = h('div', { class: 'tt-pad' }, holdBtn('arrowl', 'Left', () => move(-1, 0), true), holdBtn('rotate', 'Rotate', () => rotate(1)), holdBtn('arrowr', 'Right', () => move(1, 0), true), holdBtn('arrowd', 'Soft drop', () => soft(), true), holdBtn('download', 'Hard drop', () => hard()), holdBtn('box', 'Hold', () => doHold()));
  root.append(h('div', { class: 'tt-main' }, wrap, side), pad);

  /* ------------------------------------------------------------- engine */
  function newBag() {
    const b = [...KEYS];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }
  const take = () => {
    if (!bag.length) bag = newBag();
    return bag.pop();
  };
  const ok = (p) => cellsOf(p).every(([x, y]) => x >= 0 && x < W && y < H && (y < 0 || !board[y][x]));

  function reset() {
    board = Array.from({ length: H }, () => Array(W).fill(null));
    bag = [];
    queue = [take(), take(), take()];
    hold = null;
    canHold = true;
    score = lines = 0;
    level = 1;
    over = false;
    paused = false;
    clearing = null;
    spawn();
    last = performance.now();
    dropAt = last + speed();
    paintStats();
    paintOverlay();
  }
  const speed = () => Math.max(70, 820 * Math.pow(0.84, level - 1));
  function spawn(t) {
    const type = t || queue.shift();
    if (!t) queue.push(take());
    piece = { t: type, r: 0, x: type === 'O' ? 3 : 3, y: type === 'I' ? -1 : 0 };
    lockAt = 0;
    lockMoves = 0;
    if (!ok(piece)) {
      piece.y -= 1;
      if (!ok(piece)) return gameOver();
    }
    canHold = t ? canHold : true;
  }
  function gameOver() {
    over = true;
    if (score > best) {
      best = score;
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch {}
    }
    paintStats();
    paintOverlay();
  }
  function touchLock() {
    // moving a resting piece gives a little more time, but not forever
    if (lockAt && lockMoves < 15) {
      lockMoves++;
      lockAt = performance.now() + 450;
    }
  }
  function move(dx, dy) {
    if (!live()) return false;
    const n = { ...piece, x: piece.x + dx, y: piece.y + dy };
    if (!ok(n)) return false;
    piece = n;
    if (dx) touchLock();
    if (dy) lockAt = 0;
    return true;
  }
  function rotate(dir) {
    if (!live() || piece.t === 'O') return;
    const r = (piece.r + dir + 4) % 4;
    for (const dx of [0, -1, 1, -2, 2]) {
      const n = { ...piece, r, x: piece.x + dx };
      if (ok(n)) return ((piece = n), touchLock());
      const up = { ...n, y: n.y - 1 };
      if (ok(up)) return ((piece = up), touchLock());
    }
  }
  function soft() {
    if (!live()) return;
    if (move(0, 1)) score += 1;
    else if (!lockAt) lockAt = performance.now() + 450;
    paintStats();
    dropAt = performance.now() + speed();
  }
  function hard() {
    if (!live()) return;
    let n = 0;
    while (move(0, 1)) n++;
    score += n * 2;
    lockPiece();
    paintStats();
  }
  function doHold() {
    if (!live() || !canHold) return;
    const cur = piece.t;
    if (hold) spawn(hold);
    else spawn();
    hold = cur;
    canHold = false;
    paintMini();
  }
  const live = () => started && !over && !paused && !clearing && piece;

  function lockPiece() {
    for (const [x, y] of cellsOf(piece)) if (y >= 0) board[y][x] = piece.t;
    const full = [];
    for (let y = 0; y < H; y++) if (board[y].every(Boolean)) full.push(y);
    if (full.length) {
      clearing = { rows: full, until: performance.now() + 220 };
      piece = null;
    } else {
      spawn();
      dropAt = performance.now() + speed();
    }
    canHold = true;
  }
  function finishClear() {
    const rows = clearing.rows;
    board = board.filter((_, y) => !rows.includes(y));
    while (board.length < H) board.unshift(Array(W).fill(null));
    score += POINTS[rows.length] * level;
    lines += rows.length;
    level = Math.floor(lines / 10) + 1;
    clearing = null;
    spawn();
    dropAt = performance.now() + speed();
    paintStats();
  }

  /* --------------------------------------------------------------- loop */
  function frame(t) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (started && !over && !paused) {
      if (clearing && t >= clearing.until) finishClear();
      else if (!clearing && piece) {
        if (lockAt && t >= lockAt && !ok({ ...piece, y: piece.y + 1 })) lockPiece();
        else if (t >= dropAt) {
          dropAt = t + speed();
          if (!move(0, 1) && !lockAt) lockAt = t + 450;
        }
      }
    }
    draw(t);
  }

  /* ------------------------------------------------------------ drawing */
  function block(g, x, y, c, color, alpha = 1) {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    const r = Math.max(2, c * 0.16);
    g.beginPath();
    if (g.roundRect) g.roundRect(x + 1, y + 1, c - 2, c - 2, r);
    else g.rect(x + 1, y + 1, c - 2, c - 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.fillRect(x + 3, y + 3, c - 6, Math.max(2, c * 0.18));
    g.globalAlpha = 1;
  }
  function draw(t) {
    const c = cell;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cs = getComputedStyle(root);
    ctx.fillStyle = cs.getPropertyValue('--surface-2') || '#222';
    ctx.fillRect(0, 0, W * c, H * c);
    ctx.strokeStyle = 'rgba(128,128,150,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < W; x++) (ctx.moveTo(x * c + 0.5, 0), ctx.lineTo(x * c + 0.5, H * c));
    for (let y = 1; y < H; y++) (ctx.moveTo(0, y * c + 0.5), ctx.lineTo(W * c, y * c + 0.5));
    ctx.stroke();
    if (!board) return;
    for (let y = 0; y < H; y++) {
      const flash = clearing && clearing.rows.includes(y);
      for (let x = 0; x < W; x++) {
        const v = board[y][x];
        if (!v) continue;
        if (flash) {
          ctx.fillStyle = Math.floor(t / 55) % 2 ? '#fff' : COLORS[v];
          ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
        } else block(ctx, x * c, y * c, c, COLORS[v]);
      }
    }
    if (piece && !over) {
      let g = piece;
      while (ok({ ...g, y: g.y + 1 })) g = { ...g, y: g.y + 1 };
      if (g.y !== piece.y) for (const [x, y] of cellsOf(g)) y >= 0 && block(ctx, x * c, y * c, c, COLORS[piece.t], 0.22);
      for (const [x, y] of cellsOf(piece)) y >= 0 && block(ctx, x * c, y * c, c, COLORS[piece.t]);
    }
  }
  function drawMini(cv, types) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const c = cv.width / 4.4;
    types.forEach((t, i) => {
      if (!t) return;
      const cells = SHAPES[t][0];
      const minX = Math.min(...cells.map((p) => p[0]));
      const maxX = Math.max(...cells.map((p) => p[0]));
      const minY = Math.min(...cells.map((p) => p[1]));
      const oy = i * c * 2.6 + c * 0.4;
      const ox = (cv.width - (maxX - minX + 1) * c) / 2;
      for (const [x, y] of cells) block(g, ox + (x - minX) * c, oy + (y - minY) * c, c, COLORS[t]);
    });
  }
  function paintMini() {
    drawMini(nextC, queue || []);
    drawMini(holdC, [hold]);
  }
  function paintStats() {
    sScore.v.textContent = score;
    sLines.v.textContent = lines;
    sLevel.v.textContent = level;
    sBest.v.textContent = Math.max(best, score);
    paintMini();
  }
  function paintOverlay() {
    overlay.hidden = started && !over && !paused;
    if (overlay.hidden) return;
    const btn = (label, fn, kind = 'primary') => h('button', { class: 'btn ' + kind, type: 'button', onclick: fn }, label);
    if (over) overlay.replaceChildren(h('h3', null, 'Game over'), h('p', null, `Score ${score}` + (score && score >= best ? ' · new best!' : '')), btn('Play again', () => (reset(), (started = true), paintOverlay(), root.focus())));
    else if (paused) overlay.replaceChildren(h('h3', null, 'Paused'), btn('Resume', () => setPause(false)));
    else
      overlay.replaceChildren(
        h('h3', null, 'Tetris'),
        h('p', { class: 'tt-help' }, 'Arrows move · ↑ or X rotate · Z rotate back · Space hard drop · C hold · P pause'),
        btn('Start', () => (reset(), (started = true), paintOverlay(), root.focus()))
      );
  }
  function setPause(p) {
    if (!started || over) return;
    paused = p;
    if (!p) dropAt = performance.now() + speed();
    paintOverlay();
  }

  /* ------------------------------------------------------------- layout */
  function resize() {
    const w = wrap.clientWidth;
    const hh = wrap.clientHeight;
    if (!w || !hh) return;
    cell = Math.max(6, Math.floor(Math.min(w / W, hh / H)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = W * cell + 'px';
    canvas.style.height = H * cell + 'px';
    canvas.width = W * cell * dpr;
    canvas.height = H * cell * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mini = Math.max(44, Math.min(96, Math.floor(cell * 3.6)));
    nextC.width = holdC.width = mini * 2;
    nextC.style.width = holdC.style.width = mini + 'px';
    holdC.height = Math.round(mini * 1.1) * 2;
    holdC.style.height = Math.round(mini * 1.1) + 'px';
    nextC.height = Math.round(mini * 2.9) * 2;
    nextC.style.height = Math.round(mini * 2.9) + 'px';
    paintMini();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  /* ------------------------------------------------------------- input */
  root.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'p' || k === 'P' || k === 'Escape') return setPause(!paused), e.preventDefault();
    if (!started && (k === 'Enter' || k === ' ')) return (reset(), (started = true), paintOverlay(), e.preventDefault());
    if (over && (k === 'Enter' || k === ' ')) return (reset(), paintOverlay(), e.preventDefault());
    if (k === 'ArrowLeft') move(-1, 0);
    else if (k === 'ArrowRight') move(1, 0);
    else if (k === 'ArrowDown') soft();
    else if (k === 'ArrowUp' || k === 'x' || k === 'X') rotate(1);
    else if (k === 'z' || k === 'Z') rotate(-1);
    else if (k === ' ') hard();
    else if (k === 'c' || k === 'C' || k === 'Shift') doHold();
    else return;
    e.preventDefault();
  });
  // swipe on the board: left/right to move, down to drop, tap to rotate
  let sw = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('.tt-over')) return;
    sw = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.lx;
    const dy = e.clientY - sw.ly;
    if (Math.abs(dx) > cell) {
      move(dx > 0 ? 1 : -1, 0);
      sw.lx = e.clientX;
      sw.moved = true;
    }
    if (dy > cell * 0.9) {
      soft();
      sw.ly = e.clientY;
      sw.moved = true;
    }
  });
  wrap.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const fast = e.clientY - sw.y > cell * 4 && Math.abs(e.clientX - sw.x) < cell * 2;
    if (fast) hard();
    else if (!sw.moved && Math.hypot(e.clientX - sw.x, e.clientY - sw.y) < 10) rotate(1);
    sw = null;
  });
  wrap.addEventListener('pointercancel', () => (sw = null));
  const vis = () => document.hidden && setPause(true);
  document.addEventListener('visibilitychange', vis);
  root.addEventListener('pointerdown', () => root.focus({ preventScroll: true }));

  /* -------------------------------------------------------------- start */
  board = Array.from({ length: H }, () => Array(W).fill(null));
  queue = [take(), take(), take()];
  score = lines = 0;
  level = 1;
  started = false;
  paintStats();
  paintOverlay();
  raf = requestAnimationFrame(frame);
  setTimeout(resize, 0);

  return {
    el: root,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', vis);
    },
  };
}
