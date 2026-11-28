// WebOS — user settings store (localStorage) + live application to the document.
const KEY = 'webos.settings.v1';

export const DEFAULTS = {
  // appearance
  theme: 'auto', // auto | light | dark
  accent: '#4f7cff',
  wallpaper: 'aurora',
  wallpaperFit: 'cover', // cover | contain | center | tile
  customTone: 'dark',
  blur: true,
  animations: true,
  fontScale: 100,
  radius: 'normal', // sharp | normal | round
  windowControls: 'right', // right | left
  // desktop
  iconSize: 'medium', // small | medium | large
  showLabels: true,
  showSystemIcons: true,
  sortApps: 'name', // name | newest | oldest
  openWith: 'double', // double | single
  desktopClock: true,
  hiddenIcons: [], // desktop icon keys the user hid
  iconPos: {}, // desktop icon key -> [column, row]
  bookmarks: [], // Browser bookmarks: [{ title, url }]
  searchEngine: 'duckduckgo',
  // windows
  openMaximized: false,
  snapAssist: true,
  rememberSizes: true,
  confirmClose: false,
  appOpenMode: 'window', // window | tab
  // taskbar
  taskbarPos: 'bottom', // bottom | top
  taskbarAlign: 'center', // center | left
  taskbarLabels: false,
  taskbarAutoHide: false,
  clock24: false,
  clockSeconds: false,
  showDate: true,
  pinned: [],
  // startup & security
  bootAnimation: true,
  lockOnStart: false,
  pinHash: '',
  pinSalt: '',
  notifications: true,
  firstRun: true,
};

export const ACCENTS = [
  { name: 'Blue', value: '#4f7cff' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
];

export const WALLPAPERS = {
  aurora: {
    name: 'Aurora',
    tone: 'dark',
    css: 'radial-gradient(60% 55% at 18% 18%, #7c5cff 0%, transparent 62%), radial-gradient(55% 60% at 82% 28%, #00c8ff 0%, transparent 62%), radial-gradient(65% 65% at 58% 95%, #00e0a4 0%, transparent 62%), #0b1020',
  },
  sunset: { name: 'Sunset', tone: 'dark', css: 'linear-gradient(160deg, #ff9a76 0%, #ff5e7e 32%, #8b3ff0 72%, #2b1055 100%)' },
  ocean: {
    name: 'Ocean',
    tone: 'dark',
    css: 'radial-gradient(70% 50% at 70% 0%, #38bdf8 0%, transparent 70%), linear-gradient(180deg, #0ea5e9 0%, #2563eb 48%, #1e1b4b 100%)',
  },
  forest: {
    name: 'Forest',
    tone: 'dark',
    css: 'radial-gradient(70% 60% at 30% 15%, #34d399 0%, transparent 62%), linear-gradient(180deg, #065f46 0%, #022c22 100%)',
  },
  lavender: { name: 'Lavender', tone: 'light', css: 'linear-gradient(135deg, #f5e9ff 0%, #c9b8ff 45%, #9cc9ff 100%)' },
  dune: { name: 'Dune', tone: 'dark', css: 'linear-gradient(160deg, #fde68a 0%, #fb923c 48%, #9a3412 100%)' },
  graphite: { name: 'Graphite', tone: 'dark', css: 'radial-gradient(80% 60% at 50% 0%, #475569 0%, transparent 72%), #0f172a' },
  paper: { name: 'Paper', tone: 'light', css: 'linear-gradient(180deg, #f8fafc 0%, #d5dde8 100%)' },
};

let state = { ...DEFAULTS, ...load() };
const subs = new Set();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}
function notify(keys) {
  subs.forEach((f) => {
    try {
      f(keys);
    } catch (e) {
      console.error(e);
    }
  });
}

export const settings = {
  get: (k) => state[k],
  all: () => ({ ...state }),
  set(k, v) {
    state[k] = v;
    persist();
    apply();
    notify([k]);
  },
  patch(obj) {
    Object.assign(state, obj);
    persist();
    apply();
    notify(Object.keys(obj));
  },
  replaceAll(obj) {
    state = { ...DEFAULTS, ...obj };
    persist();
    apply();
    notify(['*']);
  },
  reset() {
    state = { ...DEFAULTS, firstRun: false };
    persist();
    apply();
    notify(['*']);
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

export const darkQuery = matchMedia('(prefers-color-scheme: dark)');
export const resolvedTheme = () => (state.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.theme);

function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#10131a' : '#ffffff';
}

/** Applies all settings to <html> as attributes and CSS variables. */
export function apply() {
  const d = document.documentElement;
  const theme = resolvedTheme();
  d.dataset.theme = theme;
  d.style.setProperty('--accent', state.accent);
  d.style.setProperty('--accent-fg', readableOn(state.accent));
  d.style.setProperty('--scale', String(state.fontScale / 100));
  d.dataset.blur = state.blur ? 'on' : 'off';
  d.dataset.anim = state.animations ? 'on' : 'off';
  d.dataset.radius = state.radius;
  d.dataset.controls = state.windowControls;
  d.dataset.icons = state.iconSize;
  d.dataset.labels = state.showLabels ? 'on' : 'off';
  d.dataset.tbpos = state.taskbarPos;
  d.dataset.tbalign = state.taskbarAlign;
  d.dataset.tblabels = state.taskbarLabels ? 'on' : 'off';
  d.dataset.autohide = state.taskbarAutoHide ? 'on' : 'off';
  d.dataset.deskclock = state.desktopClock ? 'on' : 'off';
  const wp = WALLPAPERS[state.wallpaper];
  d.dataset.tone = state.wallpaper === 'custom' ? state.customTone : wp ? wp.tone : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#10131a' : '#eef1f7';
}
darkQuery.addEventListener('change', () => {
  if (state.theme === 'auto') {
    apply();
    notify(['theme']);
  }
});

/* ---------------------------------------------------------------- PIN */
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function setPin(pin) {
  if (!pin) return settings.patch({ pinHash: '', pinSalt: '' });
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
  settings.patch({ pinSalt: salt, pinHash: await sha(salt + ':' + pin) });
}
export const hasPin = () => !!state.pinHash;
export async function checkPin(pin) {
  return !state.pinHash || (await sha(state.pinSalt + ':' + pin)) === state.pinHash;
}

apply();
