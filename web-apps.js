// WebOS — web shortcuts: add any website as an app icon that opens in a WebOS window (or its own browser window).
import { h, ico, modal, toast } from './ui.js';
import { getApp, putApp } from './db.js';

/* Many popular sites tell the browser "never show me inside another page". WebOS cannot override that, so for
 * these we default to opening them in their own browser window, which still feels like an app on a computer. */
const NO_FRAME = [
  'whatsapp.com', 'facebook.com', 'messenger.com', 'instagram.com', 'x.com', 'twitter.com', 'google.com', 'gmail.com',
  'youtube.com', 'github.com', 'linkedin.com', 'netflix.com', 'amazon.com', 'paypal.com', 'discord.com', 'tiktok.com',
  'outlook.com', 'live.com', 'office.com', 'microsoft.com', 'apple.com', 'reddit.com', 'spotify.com', 'twitch.tv',
  'telegram.org', 'slack.com', 'zoom.us', 'dropbox.com', 'pinterest.com', 'snapchat.com', 'bing.com', 'yahoo.com',
];
export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
export const blocksFraming = (url) => {
  const host = hostOf(url);
  return NO_FRAME.some((d) => host === d || host.endsWith('.' + d));
};

/** Turns what a person typed into a safe http(s) address, or null. Plain http is upgraded to https. */
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  if (u.protocol === 'http:' && !/^(localhost|127\.|192\.168\.|10\.)/.test(u.hostname)) u.protocol = 'https:';
  return u.href;
}

function niceName(url) {
  const parts = hostOf(url).split('.');
  while (parts.length > 2 && ['web', 'app', 'www', 'm', 'mail', 'my'].includes(parts[0])) parts.shift();
  const base = parts.length > 1 ? parts[parts.length - 2] : parts[0] || 'Website';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export const faviconOf = (url) => {
  try {
    return new URL('/favicon.ico', url).href;
  } catch {
    return '';
  }
};

/** A framed website with a small hint bar. Used by link apps and by the Browser. */
export function framedSite(url, { onExternal, title = 'Website' } = {}) {
  const frame = h('iframe', {
    class: 'web-frame',
    src: url,
    title,
    referrerpolicy: 'strict-origin-when-cross-origin',
    sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation',
    allow: 'fullscreen; clipboard-write; autoplay; picture-in-picture; microphone; camera; geolocation',
    allowfullscreen: true,
  });
  const host = hostOf(url);
  const key = 'webos.hint.' + host;
  let seen = false;
  try {
    seen = sessionStorage.getItem(key) === '1';
  } catch {}
  const bar = h(
    'div',
    { class: 'web-hint', hidden: seen },
    ico('info', 15),
    h('span', null, 'Blank page? Some sites do not allow being shown inside another page.'),
    onExternal && h('button', { class: 'btn small', type: 'button', onclick: onExternal }, 'Open in a new window'),
    h('button', { class: 'btn small ghost icon', type: 'button', 'aria-label': 'Dismiss', onclick: () => { bar.hidden = true; try { sessionStorage.setItem(key, '1'); } catch {} } }, ico('x', 14))
  );
  const el = h('div', { class: 'web-wrap' }, bar, frame);
  return { el, frame, reload: () => (frame.src = frame.src) };
}

/** Opens a site in its own small browser window (a real window on a computer, a new tab on a phone). */
export function openPopup(url, w = 1100, hgt = 760) {
  const win = window.open(url, '_blank', `popup=yes,width=${w},height=${hgt},noopener,noreferrer`);
  if (!win) toast('Your browser blocked the new window. Allow pop-ups for this site and try again.', { kind: 'error' });
}

// "popup" is what most people want: the site runs in its own browser tab or window, exactly as the website intends.
const MODES = [
  { value: 'popup', label: 'In its own browser tab (recommended)' },
  { value: 'window', label: 'Inside a WebOS window' },
];
const LABELS = { popup: 'In its own browser tab', window: 'Inside a WebOS window', tab: 'In a new browser tab' };
export const modeLabel = (m) => LABELS[m] || LABELS.popup;

/** A new web shortcut record, ready for putApp(). Extra fields (for example storeId) can be passed in `extra`. */
export async function newLinkRecord({ url, name, openIn = 'popup', description = '', extra = {} }) {
  const base = 'web-' + (hostOf(url) + new URL(url).pathname).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  let id = base;
  for (let i = 2; await getApp(id); i++) id = base + '-' + i;
  const now = Date.now();
  return {
    id, name: (name || niceName(url)).slice(0, 60), description: description || hostOf(url), version: '', author: '', display: 'window', width: 1000, height: 680, icon: null, size: 0, fileCount: 0,
    source: 'link', sourceUrl: url, installedAt: now, updatedAt: now, lastOpened: 0, openCount: 0, pinned: false,
    kind: 'link', url, openIn, favicon: faviconOf(url), ...extra,
  };
}

/**
 * Add or edit a web shortcut. Resolves to the saved app record, or null.
 * opts: { app (to edit), url, name }
 */
export function openShortcutDialog(opts = {}) {
  const editing = opts.app || null;
  const url = h('input', { class: 'input', type: 'text', inputmode: 'url', placeholder: 'web.whatsapp.com or https://…', value: editing ? editing.url : opts.url || '', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
  const name = h('input', { class: 'input', maxlength: '60', placeholder: 'Name', value: editing ? editing.name : opts.name || '' });
  const mode = h('select', { class: 'select full' }, MODES.map((m) => h('option', { value: m.value }, m.label)));
  mode.value = editing && editing.openIn === 'window' ? 'window' : 'popup';
  const hint = h('div', { class: 'hint-box', hidden: true });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  let nameTouched = !!(editing || opts.name);
  let modeTouched = !!editing;

  const sync = () => {
    const u = normalizeUrl(url.value);
    if (u && !nameTouched) name.value = niceName(u);
    const blocked = !!u && blocksFraming(u);
    hint.hidden = !blocked;
    mode.disabled = false;
    if (blocked) {
      hint.replaceChildren(ico('info', 16), h('span', null, `${hostOf(u)} does not allow being shown inside other pages, so it needs its own browser tab.`));
      mode.value = 'popup';
      mode.disabled = true;
    }
  };
  name.addEventListener('input', () => (nameTouched = true));
  mode.addEventListener('change', () => (modeTouched = true));
  url.addEventListener('input', sync);
  sync();

  return modal({
    title: editing ? 'Edit web shortcut' : 'Add a web shortcut',
    icon: 'shortcut',
    width: 480,
    content: h(
      'div',
      { class: 'form-stack' },
      h('p', { class: 'modal-text' }, 'Turn any website into an app icon, for example a web mail, chat or dashboard page. It needs internet to open.'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Website address'), url),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Open it'), mode),
      hint,
      err
    ),
    actions: [
      { label: 'Cancel', value: null },
      {
        label: editing ? 'Save' : 'Add shortcut',
        kind: 'primary',
        onClick: async (api) => {
          err.hidden = true;
          const u = normalizeUrl(url.value);
          if (!u) {
            err.textContent = 'Enter a website address such as example.com.';
            err.hidden = false;
            return false;
          }
          const nm = (name.value.trim() || niceName(u)).slice(0, 60);
          let rec;
          if (editing) rec = { ...editing, name: nm, url: u, sourceUrl: u, description: editing.storeId ? editing.description : hostOf(u), openIn: mode.value, favicon: faviconOf(u), updatedAt: Date.now() };
          else rec = await newLinkRecord({ url: u, name: nm, openIn: mode.value });
          await putApp(rec);
          api.close(rec);
          return false;
        },
      },
    ],
  });
}
