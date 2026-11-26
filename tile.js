// WebOS — app icon tiles (installed apps use their own icon, or a coloured letter).
import { h, ico } from './ui.js';

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

function hue(s) {
  let n = 0;
  for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % 360;
}

const gradient = (name) => `linear-gradient(135deg, hsl(${hue(name)} 70% 55%), hsl(${(hue(name) + 40) % 360} 70% 42%))`;

/** Tile for an installed app record. Size comes from the CSS variable --tile. */
export function appTile(app) {
  const url = iconUrl(app);
  const t = h('span', { class: 'tile' });
  if (url) {
    const img = h('img', { src: url, alt: '', draggable: 'false', class: /svg/.test(app.icon?.type || '') ? '' : '' });
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

/** Tile for a built-in system app (an icon on a coloured background). */
export function systemTile(iconName, color = '#4f7cff') {
  return h('span', { class: 'tile', style: { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #000))` } }, ico(iconName, 22));
}
