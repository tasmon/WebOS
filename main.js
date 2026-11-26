// WebOS — the shell: boot, desktop, taskbar, start menu, notifications, lock screen, app launching.
import { h, ico, $, toast, modal, confirmBox, showMenu, closeMenu, download, promptBox } from './ui.js';
import { OS } from './config.js';
import { settings, DEFAULTS, checkPin, hasPin } from './settings.js';
import { applyWallpaper } from './wallpaper.js';
import * as db from './db.js';
import * as wm from './wm.js';
import { appTile, systemTile, forgetIcon } from './tile.js';
import { openInstaller, announceInstall, readDrop, hasDraggedFiles } from './install-ui.js';
import { exportAppZip, InstallError } from './installer.js';
import { buildAppManager } from './app-manager.js';
import { buildSettings } from './app-settings.js';
import { buildAbout } from './app-about.js';
import { canInstall, promptInstall, onInstallChange } from './pwa.js';

/* ================================================================= state */
let apps = [];
const appSubs = new Set();
const notifications = [];
const instances = new Map(); // window key -> { destroy, go }

const SYS = {
  manager: { title: 'App Manager', icon: 'package', color: '#4f7cff', w: 880, h: 580 },
  settings: { title: 'Settings', icon: 'settings', color: '#64748b', w: 920, h: 620 },
  about: { title: 'About WebOS', icon: 'info', color: '#14b8a6', w: 480, h: 620 },
};

const emitApps = () => appSubs.forEach((f) => f());
async function reloadApps() {
  apps = await db.listApps();
  emitApps();
  drawDesktop();
  drawTaskbar();
}
const findApp = (id) => apps.find((a) => a.id === id);

/* ================================================================= host */
const host = {
  apps: () => apps,
  onAppsChange: (fn) => (appSubs.add(fn), () => appSubs.delete(fn)),
  openApp,
  openSystem,
  reloadApps,
  lock: () => showLock(),
  welcome: () => showWelcome(),
  async install(opts = {}) {
    const result = await openInstaller(opts);
    if (result) {
      await reloadApps();
      announceInstall(result, openApp);
    }
    return result;
  },
  async uninstall(app, silent = false) {
    wm.closeByApp(app.id);
    await host.clearData(app.id);
    await db.deleteApp(app.id);
    forgetIcon(app.id);
    await reloadApps();
    if (!silent) toast(`${app.name} was uninstalled.`, { kind: 'success' });
  },
  async rename(app, name) {
    app.name = name;
    await db.putApp(app);
    await reloadApps();
  },
  async togglePin(app) {
    app.pinned = !app.pinned;
    await db.putApp(app);
    drawTaskbar();
    emitApps();
  },
  toggleSysPin(id) {
    const p = new Set(settings.get('pinned'));
    p.has(id) ? p.delete(id) : p.add(id);
    settings.set('pinned', [...p]);
  },
  async unpinAll() {
    settings.set('pinned', []);
    for (const a of apps) if (a.pinned) ((a.pinned = false), await db.putApp(a));
    drawTaskbar();
    emitApps();
  },
  async clearData(id) {
    const P = `webos:${id}:`;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(P)) localStorage.removeItem(k);
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(P)) sessionStorage.removeItem(k);
      }
    } catch {}
    try {
      if (indexedDB.databases) for (const d of await indexedDB.databases()) if (d.name.startsWith(P)) indexedDB.deleteDatabase(d.name);
    } catch {}
  },
  async factoryReset() {
    wm.closeAll();
    try {
      if (indexedDB.databases) for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name);
    } catch {}
    await db.wipeDatabase();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    } catch {}
    location.reload();
  },
};

/* ======================================================= service worker */
let swReady = null;
function initSW() {
  if (swReady) return swReady;
  swReady = (async () => {
    if (!('serviceWorker' in navigator)) return false;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      return true;
    } catch (e) {
      console.warn('Service worker failed', e);
      return false;
    }
  })();
  return swReady;
}

/* ============================================================== launching */
const sysIconFn = (id) => () => systemTile(SYS[id].icon, SYS[id].color);

async function openApp(app, opts = {}) {
  app = findApp(app.id) || app;
  if (!(await initSW())) {
    toast('WebOS needs service workers to run apps. They may be disabled in private browsing or by your browser settings.', { kind: 'error', title: "Can't open app", timeout: 9000 });
    return;
  }
  app.lastOpened = Date.now();
  app.openCount = (app.openCount || 0) + 1;
  db.putApp(app).catch(() => {});
  const url = `/apps/${app.id}/`;
  if (opts.tab || settings.get('appOpenMode') === 'tab' || app.display === 'tab') {
    window.open(url, '_blank');
    return;
  }
  wm.create({
    key: 'app:' + app.id,
    appId: app.id,
    title: app.name,
    url,
    width: app.width || 900,
    height: app.height || 600,
    maximized: app.display === 'fullscreen',
    iconFn: () => appTile(app),
    actions: [
      { icon: 'refresh', title: 'Reload app', onClick: (w) => w.iframe && (w.iframe.src = w.iframe.src) },
      { icon: 'external', title: 'Open in a new tab', onClick: () => window.open(url, '_blank') },
      { icon: 'fullscreen', title: 'Full screen', onClick: (w) => w.iframe?.requestFullscreen?.().catch(() => {}) },
    ],
  });
}

function openSystem(id, arg) {
  const def = SYS[id];
  const key = 'sys:' + id;
  const existing = wm.byKey(key);
  if (existing) {
    wm.focus(existing.id);
    if (id === 'settings' && arg) instances.get(key)?.go?.(arg);
    if (id === 'manager' && arg) instances.get(key)?.select?.(arg);
    return;
  }
  let inst;
  let content;
  if (id === 'manager') {
    inst = buildAppManager(host);
    content = inst.el;
  } else if (id === 'settings') {
    inst = buildSettings(host, arg || 'appearance');
    content = inst.el;
  } else content = buildAbout();
  instances.set(key, inst || {});
  wm.create({
    key,
    title: def.title,
    iconFn: sysIconFn(id),
    content,
    width: def.w,
    height: def.h,
    minW: id === 'about' ? 360 : 460,
    minH: 360,
    onClose: () => {
      inst?.destroy?.();
      instances.delete(key);
    },
  });
  if (id === 'manager' && arg) inst.select(arg);
}

/* ================================================================ desktop */
const isCoarse = () => matchMedia('(pointer: coarse)').matches;

function sortedApps() {
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => b.installedAt - a.installedAt,
    oldest: (a, b) => a.installedAt - b.installedAt,
  }[settings.get('sortApps')];
  return [...apps].sort(by);
}

function dIcon(name, tile, onOpen, menu) {
  const b = h('button', { class: 'dicon', title: name, 'aria-label': name }, tile, h('span', { class: 'dlabel' }, name));
  let last = 0;
  b.addEventListener('click', () => {
    $$sel(b);
    if (settings.get('openWith') === 'single' || isCoarse()) onOpen();
    else if (Date.now() - last < 450) onOpen();
    last = Date.now();
  });
  b.addEventListener('keydown', (e) => e.key === 'Enter' && onOpen());
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $$sel(b);
    showMenu(e.clientX, e.clientY, menu());
  });
  return b;
}
function $$sel(el) {
  document.querySelectorAll('.dicon.sel').forEach((x) => x.classList.remove('sel'));
  el?.classList.add('sel');
}

function appMenu(app) {
  return [
    { label: 'Open', icon: 'external', onClick: () => openApp(app) },
    { label: 'Open in new tab', icon: 'globe', onClick: () => openApp(app, { tab: true }) },
    { separator: true },
    { label: app.pinned ? 'Unpin from taskbar' : 'Pin to taskbar', icon: 'pin', onClick: () => host.togglePin(app) },
    { label: 'Rename…', icon: 'edit', onClick: async () => { const v = await promptBox({ title: 'Rename app', label: 'Name', value: app.name }); if (v) host.rename(app, v.slice(0, 60)); } },
    { label: 'Export as ZIP', icon: 'upload', onClick: async () => { const t = toast('Preparing ZIP…', { timeout: 0 }); try { download(await exportAppZip(app), app.id + '.zip'); } catch (e) { toast(e.message, { kind: 'error' }); } t.close(); } },
    { label: 'Details', icon: 'info', onClick: () => openSystem('manager', app.id) },
    { separator: true },
    { label: 'Uninstall', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox({ title: `Uninstall ${app.name}?`, message: 'The app and its saved data will be removed from this browser.', confirmLabel: 'Uninstall', danger: true })) host.uninstall(app); } },
  ];
}
function sysMenu(id) {
  return [
    { label: 'Open', icon: 'external', onClick: () => openSystem(id) },
    { label: settings.get('pinned').includes(id) ? 'Unpin from taskbar' : 'Pin to taskbar', icon: 'pin', onClick: () => host.toggleSysPin(id) },
  ];
}

function drawDesktop() {
  const d = $('#desktop');
  d.replaceChildren();
  if (settings.get('showSystemIcons')) {
    for (const id of Object.keys(SYS)) d.append(dIcon(SYS[id].title, systemTile(SYS[id].icon, SYS[id].color), () => openSystem(id), () => sysMenu(id)));
    d.append(dIcon('Install app', systemTile('plus', '#22c55e'), () => host.install(), () => [{ label: 'Install app…', icon: 'plus', onClick: () => host.install() }]));
  }
  for (const app of sortedApps()) d.append(dIcon(app.name, appTile(app), () => openApp(app), () => appMenu(app)));
  if (!apps.length) {
    d.append(
      h('div', { class: 'empty-desktop' }, h('h2', null, 'Your desktop is empty'), h('p', null, 'Drop a ZIP file here or install your first web app.'), h('button', { class: 'btn primary', onclick: () => host.install() }, ico('plus', 16), 'Install app'))
    );
  }
}

$('#desktop').addEventListener('pointerdown', (e) => {
  if (e.target === e.currentTarget) $$sel(null);
});
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.dicon, input, textarea, .win, .panel, .modal, #taskbar')) return;
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [
    { label: 'Install app…', icon: 'plus', onClick: () => host.install() },
    { label: 'Refresh', icon: 'refresh', onClick: () => reloadApps() },
    { separator: true },
    { label: 'Change wallpaper', icon: 'image', onClick: () => openSystem('settings', 'appearance') },
    { label: 'Settings', icon: 'settings', onClick: () => openSystem('settings') },
    { label: 'About WebOS', icon: 'info', onClick: () => openSystem('about') },
  ]);
});

/* ================================================================ clock */
const fmtTime = (d, secs) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: secs ? '2-digit' : undefined, hour12: !settings.get('clock24') }).format(d);
const fmtDate = (d, long) => new Intl.DateTimeFormat(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
let clockEls = null;
function tickClock() {
  const now = new Date();
  if (clockEls) {
    clockEls.time.textContent = fmtTime(now, settings.get('clockSeconds'));
    clockEls.date.textContent = fmtDate(now);
    clockEls.date.hidden = !settings.get('showDate');
  }
  $('.dc-time').textContent = fmtTime(now, false);
  $('.dc-date').textContent = fmtDate(now, true);
  const lt = $('#lock .time');
  if (lt) {
    lt.textContent = fmtTime(now, false);
    $('#lock .date').textContent = fmtDate(now, true);
  }
}
setInterval(tickClock, 1000);

/* ============================================================== taskbar */
let startBtn, itemsEl, trayEl, bellBadge, netBtn, installBtn;
let panel = null;

function buildTaskbar() {
  const tb = $('#taskbar');
  tb.className = 'glass';
  startBtn = h('button', { class: 'tb-btn tb-start', title: 'Start (Alt+A)', 'aria-label': 'Start menu', 'aria-haspopup': 'true', onclick: () => togglePanel('start'), html: '<img class="logo" src="/icon.svg" alt="" width="26" height="26">' });
  itemsEl = h('div', { id: 'tb-items' });
  const time = h('b');
  const date = h('span');
  clockEls = { time, date };
  netBtn = h('button', { class: 'tb-btn tb-hide-m', title: 'Network', 'aria-label': 'Network status', onclick: () => toast(navigator.onLine ? 'You are online.' : 'You are offline. Installed apps still work.', { kind: navigator.onLine ? 'success' : 'info' }) });
  bellBadge = h('span', { class: 'badge', hidden: true });
  const bell = h('button', { class: 'tb-btn', title: 'Notifications', 'aria-label': 'Notifications', onclick: () => togglePanel('notif') }, ico('bell', 18), bellBadge);
  installBtn = h('button', { class: 'tb-btn', title: 'Install WebOS on this device', 'aria-label': 'Install WebOS', hidden: true, onclick: () => promptInstall() }, ico('download', 18));
  const clock = h('button', { class: 'tb-btn tb-clock', title: 'Calendar', onclick: () => togglePanel('cal') }, time, date);
  const showDesk = h('button', { class: 'tb-btn tb-hide-m', title: 'Show desktop (Alt+D)', 'aria-label': 'Show desktop', onclick: () => wm.minimizeAll() }, ico('monitor', 18));
  trayEl = h('div', { id: 'tb-tray' }, installBtn, netBtn, bell, clock, showDesk);
  tb.replaceChildren(startBtn, itemsEl, trayEl);
  const syncNet = () => {
    netBtn.replaceChildren(ico(navigator.onLine ? 'wifi' : 'wifioff', 18));
    netBtn.title = navigator.onLine ? 'Online' : 'Offline';
  };
  addEventListener('online', syncNet);
  addEventListener('offline', syncNet);
  syncNet();
  const syncInstall = () => (installBtn.hidden = !canInstall());
  onInstallChange(syncInstall);
  syncInstall();

  // auto-hide
  let hideT;
  const peek = () => (clearTimeout(hideT), tb.classList.add('peek'));
  const unpeek = () => {
    clearTimeout(hideT);
    hideT = setTimeout(() => !panel && tb.classList.remove('peek'), 700);
  };
  $('#tb-hot').addEventListener('pointerenter', peek);
  tb.addEventListener('pointerenter', peek);
  tb.addEventListener('pointerleave', unpeek);
  tb.addEventListener('focusin', peek);
  tb.addEventListener('focusout', unpeek);
}

function taskbarEntries() {
  const out = [];
  const used = new Set();
  for (const id of settings.get('pinned')) {
    if (!SYS[id]) continue;
    const key = 'sys:' + id;
    used.add(key);
    out.push({ title: SYS[id].title, iconFn: sysIconFn(id), win: wm.byKey(key), open: () => openSystem(id), menu: sysMenu(id), pinned: true, sys: id });
  }
  for (const a of apps.filter((x) => x.pinned)) {
    const key = 'app:' + a.id;
    used.add(key);
    out.push({ title: a.name, iconFn: () => appTile(a), win: wm.byKey(key), open: () => openApp(a), menu: appMenu(a), pinned: true });
  }
  for (const w of wm.list()) {
    if (w.key && used.has(w.key)) continue;
    const sys = w.key?.startsWith('sys:') ? w.key.slice(4) : null;
    const app = w.appId && findApp(w.appId);
    out.push({ title: w.title, iconFn: w.iconFn, win: w, open: () => wm.focus(w.id), menu: app ? appMenu(app) : sys ? sysMenu(sys) : [], pinned: false });
  }
  return out;
}

function drawTaskbar() {
  if (!itemsEl) return;
  const entries = taskbarEntries();
  itemsEl.replaceChildren(
    ...entries.map((e) => {
      const w = e.win;
      const cls = ['tb-btn'];
      if (w) cls.push('running');
      if (w && wm.activeWindow() === w && w.state !== 'min') cls.push('active');
      if (w?.state === 'min') cls.push('min-state');
      const b = h('button', { class: cls.join(' '), title: e.title, 'aria-label': e.title }, h('span', { class: 'ico' }, e.iconFn()), h('span', { class: 'tb-label' }, e.title));
      b.addEventListener('click', () => (w ? wm.toggleMinimize(w.id) : e.open()));
      b.addEventListener('auxclick', (ev) => ev.button === 1 && w && wm.close(w.id));
      b.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const items = [...(e.menu || [])];
        if (w) items.push({ separator: true }, { label: 'Close window', icon: 'x', onClick: () => wm.close(w.id) });
        const r = b.getBoundingClientRect();
        const m = showMenu(r.left, settings.get('taskbarPos') === 'top' ? r.bottom + 6 : r.top, items);
        if (settings.get('taskbarPos') !== 'top') m.style.top = Math.max(6, r.top - m.offsetHeight - 6) + 'px';
      });
      return b;
    })
  );
}
wm.onChange(drawTaskbar);

/* ================================================================ panels */
function closePanel() {
  if (!panel) return;
  panel.cleanup?.();
  panel.el.remove();
  panel.btn?.classList.remove('on');
  panel = null;
  $('#taskbar').classList.remove('peek');
}
function togglePanel(name) {
  const same = panel?.name === name;
  closePanel();
  if (same) return;
  closeMenu();
  const builders = { start: startPanel, notif: notifPanel, cal: calPanel };
  const p = builders[name]();
  p.name = name;
  $('#panels').append(p.el);
  panel = p;
  p.btn?.classList.add('on');
  $('#taskbar').classList.add('peek');
  p.focus?.();
}
document.addEventListener(
  'pointerdown',
  (e) => {
    if (panel && !panel.el.contains(e.target) && !e.target.closest('#taskbar')) closePanel();
  },
  true
);
document.addEventListener('keydown', (e) => e.key === 'Escape' && panel && closePanel());
window.addEventListener('blur', () => setTimeout(() => document.activeElement?.tagName === 'IFRAME' && closePanel(), 0));

function startPanel() {
  const search = h('input', { type: 'search', placeholder: 'Search apps and settings', 'aria-label': 'Search apps', spellcheck: 'false', autocomplete: 'off' });
  const scroll = h('div', { class: 'panel-scroll' });
  const cell = (name, tile, fn) => h('button', { class: 'app-cell', title: name, onclick: () => (closePanel(), fn()) }, tile, h('span', { class: 'n' }, name));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const sys = Object.entries(SYS).filter(([, d]) => !q || d.title.toLowerCase().includes(q));
    const list = sortedApps().filter((a) => !q || (a.name + ' ' + a.description).toLowerCase().includes(q));
    scroll.replaceChildren();
    if (!q || 'install'.includes(q) || 'add'.includes(q)) {
      scroll.append(h('div', { class: 'panel-title' }, 'System'), h('div', { class: 'app-grid' }, sys.map(([id, d]) => cell(d.title, systemTile(d.icon, d.color), () => openSystem(id))), cell('Install app', systemTile('plus', '#22c55e'), () => host.install())));
    }
    if (list.length) scroll.append(h('div', { class: 'panel-title' }, q ? 'Apps' : `Your apps (${list.length})`), h('div', { class: 'app-grid' }, list.map((a) => h('button', { class: 'app-cell', title: a.name, onclick: () => (closePanel(), openApp(a)), oncontextmenu: (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, appMenu(a)); } }, appTile(a), h('span', { class: 'n' }, a.name)))));
    else if (!q) scroll.append(h('div', { class: 'none' }, 'No apps yet. Choose “Install app” to add your first one.'));
    else if (!sys.length) scroll.append(h('div', { class: 'none' }, `Nothing found for “${search.value}”.`));
  };
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') scroll.querySelector('.app-cell')?.click();
  });
  draw();
  const foot = h(
    'div',
    { class: 'panel-foot' },
    h('div', { class: 'me' }, h('span', { class: 'avatar' }, 'W'), h('div', null, h('b', null, OS.name), h('small', null, `v${OS.version} · stored on this device`))),
    h(
      'div',
      { style: 'display:flex;gap:2px' },
      hasPin() && h('button', { class: 'btn ghost icon small', title: 'Lock', 'aria-label': 'Lock', onclick: () => (closePanel(), showLock()) }, ico('lock', 16)),
      h('button', { class: 'btn ghost icon small', title: 'Settings', 'aria-label': 'Settings', onclick: () => (closePanel(), openSystem('settings')) }, ico('settings', 16)),
      h('button', { class: 'btn ghost icon small', title: 'Restart WebOS', 'aria-label': 'Restart', onclick: () => location.reload() }, ico('power', 16))
    )
  );
  return { el: h('div', { class: 'panel start glass' }, h('div', { class: 'panel-search' }, ico('search', 16), search), scroll, foot), btn: startBtn, focus: () => search.focus() };
}

function notifPanel() {
  const list = h('div', { class: 'panel-scroll' });
  const draw = () => {
    list.replaceChildren();
    if (!notifications.length) list.append(h('div', { class: 'none' }, 'No notifications'));
    notifications.forEach((n) =>
      list.append(
        h('div', { class: 'nitem' }, n.app ? appTile(n.app) : systemTile('bell', '#64748b'), h('div', { style: 'min-width:0;flex:1' }, h('b', null, n.title), n.body && h('span', null, n.body)), h('time', null, fmtTime(new Date(n.time), false)))
      )
    );
  };
  draw();
  setBadge(0, true);
  return {
    el: h('div', { class: 'panel notif glass' }, h('div', { class: 'panel-title', style: 'margin:1rem 1.25rem 0' }, 'Notifications', h('button', { class: 'btn small ghost', onclick: () => ((notifications.length = 0), draw()) }, 'Clear all')), list),
    btn: null,
  };
}
let unread = 0;
function setBadge(n, reset) {
  unread = reset ? 0 : unread + n;
  bellBadge.hidden = !unread;
  bellBadge.textContent = unread > 9 ? '9+' : unread;
}
export function notify(title, body, app) {
  notifications.unshift({ title, body, app, time: Date.now() });
  notifications.length = Math.min(notifications.length, 50);
  if (panel?.name === 'notif') panel.el.replaceWith((panel.el = notifPanel().el));
  else setBadge(1);
  if (settings.get('notifications')) toast(body, { title, timeout: 5000, iconName: 'bell' });
}

function calPanel() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dows = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i)));
  const cells = [...dows.map((d) => h('span', { class: 'dow' }, d))];
  for (let i = 0; i < first.getDay(); i++) cells.push(h('span'));
  for (let d = 1; d <= days; d++) cells.push(h('span', { class: d === now.getDate() ? 'today' : '' }, d));
  return { el: h('div', { class: 'panel cal glass' }, h('h3', null, new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(now)), h('div', { class: 'cal-grid' }, cells)) };
}

/* ====================================================== messages from apps */
addEventListener('message', (e) => {
  const d = e.data;
  if (e.origin !== location.origin || !d || d.webos !== 1) return;
  const w = wm.byFrame(e.source);
  if (!w) return;
  const app = w.appId && findApp(w.appId);
  switch (d.type) {
    case 'notify':
      notify(String(d.title || app?.name || 'App').slice(0, 80), String(d.body || '').slice(0, 300), app);
      break;
    case 'close':
      wm.close(w.id, true);
      break;
    case 'title':
      wm.setTitle(w.id, String(d.title).slice(0, 80));
      break;
    case 'focus':
      wm.focus(w.id);
      break;
    case 'key':
      shortcut(d);
      break;
  }
});

/* ============================================================= shortcuts */
function shortcut(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return false;
  const k = (e.key || '').toLowerCase();
  const w = wm.activeWindow();
  if (k === 'w' && w) wm.close(w.id);
  else if (k === 'm' && w) wm.minimize(w.id);
  else if (k === 'd') wm.minimizeAll();
  else if (k === 'a') togglePanel('start');
  else if (k === 'i') host.install();
  else return false;
  return true;
}
addEventListener('keydown', (e) => shortcut(e) && e.preventDefault());

/* =========================================================== drag & drop */
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (!hasDraggedFiles(e)) return;
  dragDepth++;
  $('#dropzone').classList.add('show');
  $('#dropzone .dz-ico').replaceChildren(ico('download', 44));
});
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropzone').classList.remove('show');
  }
});
addEventListener('dragover', (e) => hasDraggedFiles(e) && e.preventDefault());
addEventListener('drop', async (e) => {
  if (!hasDraggedFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').classList.remove('show');
  if (e.target.closest?.('.modal')) return;
  try {
    const r = await readDrop(e.dataTransfer);
    host.install({ preload: { files: r.files, name: r.name, source: r.source } });
  } catch (err) {
    toast(err instanceof InstallError ? err.message : 'Could not read that: ' + err.message, { kind: 'error' });
  }
});

/* ================================================================= lock */
let locked = false;
function setInert(v) {
  ['#desktop', '#windows', '#taskbar', '#panels', '#deskclock'].forEach((s) => ($(s).inert = v));
}
function showLock() {
  if (locked || !hasPin()) return;
  locked = true;
  closePanel();
  closeMenu();
  const input = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'PIN', 'aria-label': 'PIN', autocomplete: 'off', maxlength: 12 });
  const msg = h('small');
  const tryUnlock = async () => {
    if (await checkPin(input.value)) {
      $('#lock').hidden = true;
      $('#lock').replaceChildren();
      setInert(false);
      locked = false;
    } else {
      msg.textContent = 'Wrong PIN';
      input.classList.remove('bad');
      void input.offsetWidth;
      input.classList.add('bad');
      input.value = '';
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && tryUnlock());
  const lock = $('#lock');
  lock.replaceChildren(h('div', { class: 'lock-card' }, h('div', { class: 'time' }), h('div', { class: 'date' }), h('div', { class: 'avatar' }, 'W'), h('div', null, h('b', null, OS.name)), input, msg, h('button', { class: 'btn', onclick: tryUnlock }, 'Unlock')));
  lock.hidden = false;
  setInert(true);
  tickClock();
  setTimeout(() => input.focus(), 50);
}

/* ============================================================== welcome */
function showWelcome() {
  const step = (n, t, d) => h('div', { style: 'display:flex;gap:.8rem;margin-top:.9rem' }, h('span', { class: 'chip ok', style: 'height:26px;width:26px;justify-content:center;flex:none' }, n), h('div', null, h('b', null, t), h('div', { class: 'hint' }, d)));
  return modal({
    title: 'Welcome to WebOS',
    icon: 'zap',
    width: 480,
    content: h('div', null, h('p', { class: 'modal-text' }, 'A tiny operating system that lives in your browser. Install any static website as an app and run it in a window.'),
      step('1', 'Get a ZIP', 'Any static site: a ZIP from GitHub, your build folder, or a folder with an index.html.'),
      step('2', 'Drop it on the desktop', 'Or choose Install app. You can also install straight from a GitHub link.'),
      step('3', 'Open it', 'Apps work offline and keep their own saved data. Right-click icons for more options.')),
    actions: [{ label: 'Maybe later', value: false }, { label: 'Install an app', value: true, kind: 'primary' }],
  }).then((v) => v && host.install());
}

/* ================================================================== boot */
async function boot() {
  const started = performance.now();
  if (settings.get('firstRun') && !settings.get('pinned').length) settings.patch({ pinned: ['manager', 'settings'] });
  applyWallpaper();
  buildTaskbar();
  tickClock();
  try {
    apps = await db.listApps();
  } catch (e) {
    toast('Storage is unavailable in this browser mode. Apps cannot be installed.', { kind: 'error', timeout: 0 });
  }
  drawDesktop();
  drawTaskbar();
  initSW();
  settings.subscribe((keys) => {
    if (keys.some((k) => ['showSystemIcons', 'sortApps', '*'].includes(k))) drawDesktop();
    if (keys.some((k) => ['pinned', 'taskbarLabels', '*'].includes(k))) drawTaskbar();
    if (keys.some((k) => ['clock24', 'clockSeconds', 'showDate', 'desktopClock', '*'].includes(k))) tickClock();
  });

  const minBoot = settings.get('bootAnimation') ? 950 : 0;
  await new Promise((r) => setTimeout(r, Math.max(0, minBoot - (performance.now() - started))));
  $('#boot').classList.add('gone');
  setTimeout(() => $('#boot').remove(), 700);

  if (settings.get('lockOnStart') && hasPin()) showLock();
  handleDeepLink();
  if (settings.get('firstRun')) {
    settings.set('firstRun', false);
    if (!apps.length && !location.hash.startsWith('#install=')) setTimeout(showWelcome, 450);
  }
}

/** Share links:  https://webos.asf.run/#install=github:owner/repo   or   #install=https://…/app.zip */
function handleDeepLink() {
  const m = /^#install=(.+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const v = decodeURIComponent(m[1]);
  const gh = v.startsWith('github:');
  host.install({ tab: gh ? 'github' : 'url', prefill: gh ? v.slice(7) : v, autoStart: true });
}
addEventListener('hashchange', handleDeepLink);

boot();
