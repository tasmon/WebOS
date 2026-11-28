// WebOS — wallpaper rendering and custom wallpaper upload.
import { settings, WALLPAPERS, DEFAULT_WALLPAPER } from './settings.js';
import { kvGet, kvSet, kvDel } from './db.js';

let objectUrl = null;

export async function applyWallpaper() {
  const el = document.getElementById('wallpaper');
  const id = settings.get('wallpaper');
  el.style.cssText = '';
  if (id === 'custom') {
    let blob = null;
    try {
      blob = await kvGet('wallpaper');
    } catch {}
    if (blob) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      const fit = settings.get('wallpaperFit');
      el.style.backgroundColor = '#0b0e16';
      el.style.backgroundImage = `url("${objectUrl}")`;
      el.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
      el.style.backgroundPosition = 'center';
      el.style.backgroundSize = fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'auto';
      return;
    }
  }
  el.style.background = (WALLPAPERS[id] || WALLPAPERS[DEFAULT_WALLPAPER]).css;
}

/** Downscales a user image (max 2560px), stores it and switches to it. */
export async function setCustomWallpaper(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hh = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, hh);
  // measure brightness to choose light or dark desktop labels
  const s = document.createElement('canvas');
  s.width = s.height = 24;
  const sctx = s.getContext('2d');
  sctx.drawImage(bmp, 0, 0, 24, 24);
  const px = sctx.getImageData(0, 0, 24, 24).data;
  let lum = 0;
  for (let i = 0; i < px.length; i += 4) lum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
  lum /= px.length / 4;
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  await kvSet('wallpaper', blob);
  settings.patch({ wallpaper: 'custom', customTone: lum > 0.6 ? 'light' : 'dark' });
}
export async function removeCustomWallpaper() {
  try {
    await kvDel('wallpaper');
  } catch {}
  if (settings.get('wallpaper') === 'custom') settings.set('wallpaper', DEFAULT_WALLPAPER);
}
export async function hasCustomWallpaper() {
  try {
    return !!(await kvGet('wallpaper'));
  } catch {
    return false;
  }
}
settings.subscribe((keys) => {
  if (keys.some((k) => ['wallpaper', 'wallpaperFit', '*'].includes(k))) applyWallpaper();
});
