// WebOS — app icon tiles (installed apps use their own icon, or a coloured letter).
import { h, ico } from './ui.js';
import { TILE_ART } from './tile-art.js';

const urls = new Map(); // appId -> { blob, url }

function iconUrl(app) {
  if (!app.icon) return null;
  const c = urls.get(app.id);
  if (c && c.blob === app.icon) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(app.icon);
  urls.set(app.id, { blob: app.icon, url });
  return url;
}
export const forgetIcon = (id) => {
  const c = urls.get(id);
  if (c) URL.revokeObjectURL(c.url);
  urls.delete(id);
};
export const appIconUrl = iconUrl;

const PALETTE = ['#e4572e', '#3a5ccc', '#118ab2', '#d1457a', '#6c4ab6', '#2f9e44', '#e09f1f', '#0f9d8a', '#c1272d', '#4b5563'];
/** A flat colour for apps that have no icon of their own, picked from a fixed palette by name. */
export function tileColor(name) {
  let n = 0;
  for (const ch of String(name || '?')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}
const gradient = tileColor;

/** Tile for an installed app record. Size comes from the CSS variable --tile. */
export function appTile(app) {
  const url = iconUrl(app) || (app.kind === 'link' && app.favicon) || null;
  const t = h('span', { class: 'tile' });
  if (url) {
    const img = h('img', { src: url, alt: '', draggable: 'false', referrerpolicy: 'no-referrer', class: /svg/.test(app.icon?.type || '') ? '' : '' });
    const fallback = () => {
      img.replaceWith(letter(app));
      t.style.background = gradient(app.name);
    };
    img.addEventListener('error', fallback);
    t.append(img);
  } else {
    t.append(letter(app));
    t.style.background = gradient(app.name);
  }
  return t;
}
function letter(app) {
  const ch = ([...(app.name || '?').trim()][0] || '?').toUpperCase();
  return h('span', { class: 'ltr' }, ch);
}

/** Tile for a built-in system app: a hand-drawn glyph on a flat colour. */
export function systemTile(iconName, color = '#4f7cff') {
  const t = h('span', { class: 'tile sys' });
  t.style.setProperty('--c', color);
  t.style.background = color;
  if (TILE_ART[iconName]) t.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${TILE_ART[iconName]}</svg>`;
  else t.append(ico(iconName, 22));
  return t;
}
