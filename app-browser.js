// WebOS — Browser: open websites inside a WebOS window. Sites that refuse to be framed get a clear "open in new window" card.
import { h, ico, toast, showMenu } from './ui.js';
import { settings } from './settings.js';
import { normalizeUrl, blocksFraming, hostOf, framedSite, openPopup, faviconOf } from './web-apps.js';

const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  brave: { name: 'Brave', url: 'https://search.brave.com/search?q=%s' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
};
const SUGGESTED = [
  { title: 'Wikipedia', url: 'https://en.wikipedia.org/' },
  { title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' },
  { title: 'Internet Archive', url: 'https://archive.org/' },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' },
];

function siteTile(title, url, size = 44) {
  const t = h('span', { class: 'tile', style: { '--tile': size + 'px' } });
  const letter = () => {
    t.replaceChildren(h('span', { class: 'ltr' }, ([...title][0] || '?').toUpperCase()));
    let n = 0;
    for (const c of hostOf(url)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    t.style.background = `linear-gradient(135deg, hsl(${n % 360} 65% 52%), hsl(${(n + 40) % 360} 65% 40%))`;
  };
  const img = h('img', { src: faviconOf(url), alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', letter);
  img.addEventListener('load', () => img.naturalWidth < 8 && letter());
  t.append(img);
  return t;
}

export function buildBrowser(host, startUrl) {
  const root = h('div', { class: 'browser' });
  let hist = [];
  let idx = -1;
  let current = null; // { url, view }
  let destroyed = false;

  const bookmarks = () => settings.get('bookmarks') || [];
  const isMarked = (u) => bookmarks().some((b) => b.url === u);

  const address = h('input', { class: 'input br-addr', type: 'text', inputmode: 'url', placeholder: 'Search or type a web address', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Address' });
  const btn = (icon, title, fn) => h('button', { class: 'btn ghost small icon', type: 'button', title, 'aria-label': title, onclick: fn }, ico(icon, 17));
  const back = btn('arrowl', 'Back', () => go(idx - 1, true));
  const fwd = btn('arrowr', 'Forward', () => go(idx + 1, true));
  const reload = btn('refresh', 'Reload', () => current?.view?.reload?.());
  const home = btn('home', 'Start page', () => navigate(''));
  const star = btn('star', 'Bookmark this page', () => toggleMark());
  const more = btn('more', 'More', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const u = current?.url;
    showMenu(r.right - 220, r.bottom + 4, [
      { label: 'Open in a new tab', icon: 'external', disabled: !u, onClick: () => window.open(u, '_blank', 'noopener,noreferrer') },
      { label: 'Open in its own window', icon: 'windows', disabled: !u, onClick: () => openPopup(u) },
      { label: 'Add as an app…', icon: 'shortcut', disabled: !u, onClick: () => host.addShortcut({ url: u }) },
      { label: 'Copy address', icon: 'link', disabled: !u, onClick: () => navigator.clipboard?.writeText(u).then(() => toast('Address copied.', { kind: 'success' }), () => {}) },
    ]);
  });
  const bar = h('form', { class: 'br-bar', onsubmit: (e) => (e.preventDefault(), navigate(address.value)) }, back, fwd, reload, home, address, star, more);
  const stage = h('div', { class: 'br-stage' });
  root.append(bar, stage);

  function resolve(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const u = normalizeUrl(s);
    if (u) return u;
    const eng = ENGINES[settings.get('searchEngine')] || ENGINES.duckduckgo;
    return eng.url.replace('%s', encodeURIComponent(s));
  }
  function navigate(input) {
    const url = resolve(input);
    hist = hist.slice(0, idx + 1);
    if (hist[hist.length - 1] !== url) hist.push(url);
    idx = hist.length - 1;
    show(url);
  }
  function go(i, fromButton) {
    if (i < 0 || i >= hist.length) return;
    idx = i;
    show(hist[i], fromButton);
  }
  function toggleMark() {
    const u = current?.url;
    if (!u) return toast('Open a page first, then bookmark it.');
    const list = bookmarks();
    if (isMarked(u)) settings.set('bookmarks', list.filter((b) => b.url !== u));
    else settings.set('bookmarks', [...list, { title: hostOf(u) || u, url: u }].slice(-48));
    syncBar();
  }
  function syncBar() {
    back.disabled = idx <= 0;
    fwd.disabled = idx >= hist.length - 1;
    const u = current?.url || '';
    reload.disabled = !u;
    star.classList.toggle('on', !!u && isMarked(u));
  }

  function show(url) {
    address.value = url;
    current = { url, view: null };
    if (!url) stage.replaceChildren(startPage());
    else if (blocksFraming(url)) stage.replaceChildren(blockedCard(url));
    else {
      const v = framedSite(url, { onExternal: () => openPopup(url), title: hostOf(url) });
      current.view = v;
      stage.replaceChildren(v.el);
    }
    syncBar();
  }

  function blockedCard(url) {
    return h(
      'div',
      { class: 'br-card' },
      h('div', { class: 'br-card-ico' }, ico('shield', 30)),
      h('h3', null, `${hostOf(url)} cannot be shown here`),
      h('p', null, 'This site does not allow being opened inside another page. That is the site’s own rule, so WebOS cannot change it. You can still use it in its own window.'),
      h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: () => openPopup(url) }, ico('windows', 16), 'Open in its own window'), h('button', { class: 'btn', onclick: () => window.open(url, '_blank', 'noopener,noreferrer') }, ico('external', 16), 'New tab'), h('button', { class: 'btn', onclick: () => host.addShortcut({ url }) }, ico('shortcut', 16), 'Add as an app'))
    );
  }

  function startPage() {
    const q = h('input', { class: 'input br-search', type: 'search', placeholder: 'Search the web or type an address', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search' });
    const eng = h('select', { class: 'select', 'aria-label': 'Search engine', onchange: () => settings.set('searchEngine', eng.value) }, Object.entries(ENGINES).map(([k, v]) => h('option', { value: k }, v.name)));
    eng.value = settings.get('searchEngine') in ENGINES ? settings.get('searchEngine') : 'duckduckgo';
    const form = h('form', { class: 'br-sform', onsubmit: (e) => (e.preventDefault(), q.value.trim() && navigate(q.value)) }, h('div', { class: 'br-sbox' }, ico('search', 18), q), eng);
    const tiles = (list, removable) =>
      h(
        'div',
        { class: 'br-tiles' },
        list.map((b) =>
          h('div', { class: 'br-site' }, h('button', { class: 'br-site-btn', type: 'button', title: b.url, onclick: () => navigate(b.url) }, siteTile(b.title, b.url), h('span', null, b.title)), removable && h('button', { class: 'br-x', type: 'button', title: 'Remove bookmark', 'aria-label': 'Remove bookmark', onclick: () => (settings.set('bookmarks', bookmarks().filter((x) => x.url !== b.url)), show('')) }, ico('x', 12)))
        )
      );
    const marks = bookmarks();
    return h(
      'div',
      { class: 'br-start' },
      h('div', { class: 'br-hero' }, h('div', { class: 'br-logo' }, ico('globe', 34)), h('h2', null, 'Browser')),
      form,
      marks.length > 0 && [h('h4', null, 'Bookmarks'), tiles(marks, true)],
      h('h4', null, 'Suggested'),
      tiles(SUGGESTED, false),
      h('p', { class: 'hint br-note' }, 'Websites decide whether they can be shown inside other pages. If one stays blank or says it cannot be shown here, open it in its own window.')
    );
  }

  const unsub = settings.subscribe?.((keys) => {
    if (destroyed) return;
    if (keys.includes('bookmarks') || keys.includes('*')) syncBar();
  });

  const first = startUrl ? normalizeUrl(startUrl) || '' : '';
  if (first) navigate(first);
  else {
    hist = [''];
    idx = 0;
    show('');
  }

  return {
    el: root,
    go: (u) => navigate(u),
    destroy() {
      destroyed = true;
      unsub?.();
    },
  };
}
