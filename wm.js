// WebOS — window manager: drag, resize, snap, minimize, maximize, focus, iframe app windows.
// API used by main.js: create, byKey, byFrame, list, activeWindow, focus, minimize, toggleMinimize,
// minimizeAll, close, closeByApp, closeAll, setTitle, onChange, clearSavedSizes.
import { h, ico, icon, confirmBox } from './ui.js';
import { settings } from './settings.js';

const layer = () => document.getElementById('windows');
const wins = new Map(); // id -> window object
const listeners = new Set();
let zTop = 10;
let active = null;
let seq = 0;
let cascade = 0;

export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((f) => f());
const isMobile = () => innerWidth < 720;

export const list = () => [...wins.values()];
export const activeWindow = () => active;
export const byKey = (key) => list().find((w) => w.key === key) || null;
export const byFrame = (cw) => list().find((w) => w.iframe && w.iframe.contentWindow === cw) || null;
const get = (id) => wins.get(id);

/** The area windows may use (the #windows layer, which already excludes the taskbar). */
const area = () => ({ w: layer().clientWidth, h: layer().clientHeight });

/* ------------------------------------------------------- remembered sizes */
const SIZE_KEY = 'webos.winsizes';
const loadSizes = () => {
  try {
    return JSON.parse(localStorage.getItem(SIZE_KEY)) || {};
  } catch {
    return {};
  }
};
function saveSize(key, w, hh) {
  if (!settings.get('rememberSizes') || !key) return;
  const s = loadSizes();
  s[key] = { w, h: hh };
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(s));
  } catch {}
}
export function clearSavedSizes() {
  try {
    localStorage.removeItem(SIZE_KEY);
  } catch {}
}

/* --------------------------------------------------------------- layout */
function layout(w) {
  const a = area();
  const el = w.el;
  let r;
  if (w.snap === 'left') r = { x: 0, y: 0, w: Math.floor(a.w / 2), h: a.h };
  else if (w.snap === 'right') r = { x: Math.floor(a.w / 2), y: 0, w: Math.ceil(a.w / 2), h: a.h };
  else {
    r = w.rect;
    r.w = Math.min(r.w, a.w);
    r.h = Math.min(r.h, a.h);
    r.x = Math.min(Math.max(r.x, 120 - r.w), a.w - 120); // always keep a grabbable part visible
    r.y = Math.min(Math.max(r.y, 0), a.h - 40);
  }
  Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  const full = w.snap === 'max';
  el.classList.toggle('max', full);
  w.maxBtn.innerHTML = icon(full || isMobile() ? 'restore' : 'maximize', 14);
  w.maxBtn.title = full ? 'Restore' : 'Maximize';
}
const relayout = () => wins.forEach(layout);
addEventListener('resize', relayout);
settings.subscribe((k) => {
  if (k.some((x) => ['taskbarPos', 'taskbarAutoHide', '*'].includes(x))) requestAnimationFrame(relayout);
  if (k.some((x) => ['theme', 'accent', '*'].includes(x))) requestAnimationFrame(broadcastEnv);
});

/* ----------------------------------------------------- theme for the apps */
function postEnv(frame) {
  try {
    const cs = getComputedStyle(document.documentElement);
    frame.contentWindow.postMessage(
      { webos: 1, type: 'env', theme: document.documentElement.dataset.theme, accent: cs.getPropertyValue('--accent').trim() },
      location.origin
    );
  } catch {}
}
const broadcastEnv = () => wins.forEach((w) => w.iframe && postEnv(w.iframe));

/* ---------------------------------------------------------------- focus */
export function focus(id) {
  const w = get(id);
  if (!w) return;
  if (w.state === 'min') setMin(w, false);
  w.el.style.zIndex = ++zTop;
  if (active !== w) {
    active?.el.classList.remove('active');
    active = w;
    w.el.classList.add('active');
    emit();
  }
}
function pickNext() {
  const next = list()
    .filter((w) => w.state !== 'min')
    .sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex)[0];
  active = null;
  if (next) focus(next.id);
  else emit();
}
function setMin(w, v) {
  if ((w.state === 'min') === v) return;
  w.state = v ? 'min' : 'open';
  w.el.classList.toggle('min', v);
  if (v) w.el.setAttribute('inert', '');
  else w.el.removeAttribute('inert');
  if (v && active === w) {
    w.el.classList.remove('active');
    pickNext();
  } else emit();
}
export const minimize = (id) => get(id) && setMin(get(id), true);
export function toggleMinimize(id) {
  const w = get(id);
  if (!w) return;
  if (w.state === 'min' || active !== w) focus(id);
  else setMin(w, true);
}
export const minimizeAll = () => {
  const open = list().some((w) => w.state !== 'min');
  list().forEach((w) => setMin(w, open)); // second press brings everything back
  if (!open) list()[0] && focus(list()[list().length - 1].id);
};
function toggleMax(w) {
  if (isMobile()) return;
  w.snap = w.snap === 'max' ? null : 'max';
  layout(w);
  focus(w.id);
}

/* ---------------------------------------------------------------- close */
export function close(id) {
  const w = get(id);
  if (!w) return;
  wins.delete(id);
  try {
    w.onClose?.();
  } catch (e) {
    console.error(e);
  }
  w.el.classList.add('closing');
  w.el.setAttribute('inert', '');
  setTimeout(() => w.el.remove(), settings.get('animations') ? 170 : 0);
  if (active === w) pickNext();
  else emit();
}
export const closeByApp = (appId) => list().filter((w) => w.appId === appId).forEach((w) => close(w.id));
export const closeAll = () => list().forEach((w) => close(w.id));
export function setTitle(id, title) {
  const w = get(id);
  if (!w) return;
  w.title = title;
  w.titleEl.textContent = title;
  w.el.setAttribute('aria-label', title);
  emit();
}

/* ---------------------------------------------------------------- create */
/**
 * opts: { key, appId, title, url | content, width, height, minW, minH, maximized,
 *         iconFn, actions:[{icon,title,onClick(win)}], onClose }
 * Returns the existing window (focused) when `key` is already open.
 */
export function create(opts) {
  const existing = opts.key && byKey(opts.key);
  if (existing) {
    focus(existing.id);
    return existing;
  }
  const a = area();
  const saved = settings.get('rememberSizes') && opts.key ? loadSizes()[opts.key] : null;
  const minW = opts.minW || 320;
  const minH = opts.minH || 240;
  const width = Math.max(minW, Math.min(saved?.w || opts.width || 860, a.w - 24));
  const height = Math.max(minH, Math.min(saved?.h || opts.height || 580, a.h - 24));
  const step = cascade++ % 7;
  const rect = {
    x: Math.max(8, Math.round((a.w - width) / 2) + (step - 3) * 28),
    y: Math.max(8, Math.round((a.h - height) / 2) + (step - 3) * 24),
    w: width,
    h: height,
  };

  const w = {
    id: 'win' + ++seq,
    key: opts.key || null,
    appId: opts.appId || null,
    title: opts.title || 'Window',
    iconFn: opts.iconFn || (() => ico('box', 18)),
    state: 'open',
    snap: opts.maximized || settings.get('openMaximized') ? 'max' : null,
    rect,
    minW,
    minH,
    onClose: opts.onClose,
    iframe: null,
    el: null,
  };

  w.titleEl = h('span', { class: 'win-title' }, w.title);
  w.maxBtn = h('button', { class: 'wc max', type: 'button', 'aria-label': 'Maximize', title: 'Maximize', html: icon('maximize', 14) });
  const minBtn = h('button', { class: 'wc min', type: 'button', 'aria-label': 'Minimize', title: 'Minimize', html: icon('minus', 14) });
  const closeBtn = h('button', { class: 'wc close', type: 'button', 'aria-label': 'Close', title: 'Close', html: icon('x', 14) });

  const actionBtns = (opts.actions || []).map((act) =>
    h('button', { class: 'win-act', type: 'button', title: act.title, 'aria-label': act.title, html: icon(act.icon, 15), onclick: () => act.onClick?.(w) })
  );
  const bar = h(
    'div',
    { class: 'win-bar' },
    h('div', { class: 'win-id' }, h('span', { class: 'win-icon' }, w.iconFn()), w.titleEl),
    actionBtns.length > 0 && h('div', { class: 'win-actions' }, actionBtns),
    h('div', { class: 'win-ctrl' }, minBtn, w.maxBtn, closeBtn)
  );
  const body = h('div', { class: 'win-body' });
  const el = h('div', { class: 'win opening', role: 'dialog', 'aria-label': w.title, tabindex: '-1' }, bar, body);
  ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((d) => el.append(h('div', { class: 'rz rz-' + d, 'data-dir': d })));
  w.el = el;

  if (opts.url) {
    const frame = h('iframe', {
      class: 'win-frame',
      src: opts.url,
      title: w.title,
      allow: 'fullscreen; clipboard-read; clipboard-write; autoplay; camera; microphone; geolocation; gamepad; picture-in-picture',
      allowfullscreen: true,
    });
    frame.addEventListener('load', () => postEnv(frame));
    w.iframe = frame;
    body.append(frame);
  } else if (opts.content) body.append(opts.content);

  layer().append(el);
  wins.set(w.id, w);
  layout(w);
  focus(w.id);
  el.addEventListener('animationend', () => el.classList.remove('opening'), { once: true });
  wire(w, bar, minBtn, closeBtn);
  return w;
}

/* --------------------------------------------------------- interactions */
function wire(w, bar, minBtn, closeBtn) {
  const el = w.el;
  el.addEventListener('pointerdown', () => active !== w && focus(w.id), true);
  minBtn.addEventListener('click', () => setMin(w, true));
  closeBtn.addEventListener('click', async () => {
    if (settings.get('confirmClose')) {
      focus(w.id);
      const ok = await confirmBox({ title: `Close ${w.title}?`, message: 'Unsaved changes in this window may be lost.', confirmLabel: 'Close', danger: true });
      if (!ok) return;
    }
    close(w.id);
  });
  w.maxBtn.addEventListener('click', () => toggleMax(w));
  bar.addEventListener('dblclick', (e) => !e.target.closest('button') && toggleMax(w));

  // ---- drag by title bar
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || isMobile()) return;
    const L = layer().getBoundingClientRect();
    const a = area();
    let sx = e.clientX;
    let sy = e.clientY;
    let moved = false;
    let snapTo = null;
    const base = { x: w.rect.x, y: w.rect.y };
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        layer().classList.add('dragging');
        if (w.snap) {
          // pull out of maximized/snapped state, keeping the grab point under the cursor
          const cur = el.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (sx - cur.left) / cur.width));
          w.snap = null;
          base.x = Math.round(ev.clientX - L.left - w.rect.w * ratio);
          base.y = Math.round(ev.clientY - L.top - 18);
          sx = ev.clientX;
          sy = ev.clientY;
        }
      }
      w.rect.x = base.x + (ev.clientX - sx);
      w.rect.y = Math.min(Math.max(base.y + (ev.clientY - sy), 0), a.h - 40);
      layout(w);
      snapTo = null;
      if (settings.get('snapAssist')) {
        if (ev.clientY - L.top <= 2) snapTo = 'max';
        else if (ev.clientX - L.left <= 3) snapTo = 'left';
        else if (ev.clientX - L.left >= a.w - 4) snapTo = 'right';
      }
      showSnap(snapTo);
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      layer().classList.remove('dragging');
      showSnap(null);
      if (moved && snapTo) {
        w.snap = snapTo;
        layout(w);
      }
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  // ---- resize from edges and corners
  el.querySelectorAll('.rz').forEach((hd) =>
    hd.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || w.snap || isMobile()) return;
      e.preventDefault();
      e.stopPropagation();
      focus(w.id);
      const dir = hd.dataset.dir;
      const s = { ...w.rect };
      const sx = e.clientX;
      const sy = e.clientY;
      hd.setPointerCapture(e.pointerId);
      layer().classList.add('dragging');
      const move = (ev) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        let { x, y, w: ww, h: hh } = s;
        if (dir.includes('e')) ww = Math.max(w.minW, s.w + dx);
        if (dir.includes('s')) hh = Math.max(w.minH, s.h + dy);
        if (dir.includes('w')) {
          ww = Math.max(w.minW, s.w - dx);
          x = s.x + (s.w - ww);
        }
        if (dir.includes('n')) {
          hh = Math.max(w.minH, s.h - dy);
          y = s.y + (s.h - hh);
          if (y < 0) {
            hh += y;
            y = 0;
          }
        }
        w.rect = { x, y, w: ww, h: hh };
        layout(w);
      };
      const up = () => {
        hd.removeEventListener('pointermove', move);
        hd.removeEventListener('pointerup', up);
        hd.removeEventListener('pointercancel', up);
        layer().classList.remove('dragging');
        saveSize(w.key, w.rect.w, w.rect.h);
      };
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up);
      hd.addEventListener('pointercancel', up);
    })
  );
}

function showSnap(kind) {
  const p = document.getElementById('snap-preview');
  if (!kind) return p.classList.remove('show');
  const L = layer().getBoundingClientRect();
  const half = Math.floor(L.width / 2);
  const [x, wd] = kind === 'left' ? [0, half] : kind === 'right' ? [half, L.width - half] : [0, L.width];
  Object.assign(p.style, { left: L.left + x + 6 + 'px', width: wd - 12 + 'px', top: L.top + 6 + 'px', height: L.height - 12 + 'px' });
  p.classList.add('show');
}
