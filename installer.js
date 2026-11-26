// WebOS — turns ZIP files / folders / GitHub repos / URLs into installed apps.
import { saveAppWithFiles, getApp, listApps, getAppFiles, deleteApp, putApp } from './db.js';

const MAX_FILES = 6000;
const MAX_TOTAL = 400 * 1024 * 1024;
const SKIP = /(^|\/)(__MACOSX|\.git|\.github|\.vscode|\.idea|node_modules)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$/i;

export class InstallError extends Error {}

const slug = (s) =>
  String(s || 'app')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'app';

const norm = (p) =>
  p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');

/* ------------------------------------------------------------ read sources */
export async function readZipFile(file, onProgress) {
  if (!window.JSZip) throw new InstallError('The ZIP engine failed to load. Check your connection and reload.');
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new InstallError('This file is not a valid ZIP archive.');
  }
  const entries = [];
  zip.forEach((path, entry) => {
    if (!entry.dir) entries.push({ path: norm(path), entry });
  });
  const out = [];
  let done = 0;
  for (const e of entries) {
    if (!e.path || SKIP.test(e.path)) continue;
    out.push({ path: e.path, getBlob: () => e.entry.async('blob') });
    done++;
    onProgress?.(done / entries.length);
  }
  return out;
}

/** Files from <input webkitdirectory> or a dropped folder. */
export function readFolderFiles(fileList) {
  const out = [];
  for (const f of fileList) {
    const p = norm(f.webkitRelativePath || f.name);
    if (p && !SKIP.test(p)) out.push({ path: p, getBlob: async () => f });
  }
  return out;
}

export function parseGitHubUrl(input) {
  const s = input.trim();
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/?#]+)(?:\/(.*?))?)?\/?(?:[?#].*)?$/i.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] ? decodeURIComponent(m[3]) : null, subdir: m[4] || '' };
  m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: null, subdir: '' };
  return null;
}

async function fetchBlob(url, onProgress, label) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch {
    throw new InstallError(
      (label || 'That address') + " couldn't be downloaded. The server probably blocks browser downloads (CORS). Download the ZIP yourself and drop it here instead."
    );
  }
  if (!res.ok) throw new InstallError(`${label || 'Download'} failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  return new Blob(chunks, { type: 'application/zip' });
}

const RAW_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function ghJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    throw new InstallError("Couldn't reach GitHub. Check your internet connection and try again.");
  }
  if (res.status === 404) throw Object.assign(new InstallError('Repository or branch not found. It must be public and spelled correctly.'), { notFound: true });
  if (res.status === 403 || res.status === 429)
    throw Object.assign(new InstallError('GitHub is limiting requests from your network for a few minutes. Wait a little, or download the ZIP and drop it in.'), { limited: true });
  if (!res.ok) throw new InstallError(`GitHub returned an error (HTTP ${res.status}).`);
  return res.json();
}

/** Lists every file of a repo: GitHub API first, jsDelivr as a backup. */
async function listGitHub(gh) {
  const base = `${gh.owner}/${gh.repo}`;
  let refs = gh.ref ? [gh.ref] : [];
  if (!refs.length) {
    try {
      refs = [(await ghJson(`https://api.github.com/repos/${base}`)).default_branch];
    } catch (e) {
      if (e.notFound) throw e;
      refs = ['main', 'master'];
    }
  }
  let lastErr;
  for (const ref of refs) {
    try {
      const t = await ghJson(`https://api.github.com/repos/${base}/git/trees/${encPath(ref)}?recursive=1`);
      return { ref, items: (t.tree || []).filter((x) => x.type === 'blob').map((x) => ({ full: x.path, size: x.size || 0 })) };
    } catch (e) {
      lastErr = e;
    }
  }
  for (const ref of refs) {
    try {
      const r = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${base}@${encodeURIComponent(ref)}?structure=flat`);
      if (r.ok) {
        const j = await r.json();
        return { ref, items: (j.files || []).map((f) => ({ full: String(f.name).replace(/^\//, ''), size: f.size || 0 })) };
      }
    } catch {}
  }
  throw lastErr || new InstallError("Couldn't read that repository. Check the address and that it is public.");
}

export async function readGitHub(gh, onProgress) {
  const { ref, items } = await listGitHub(gh);
  let files = items.filter((i) => i.full && !SKIP.test(i.full)).map((i) => ({ ...i, path: i.full }));
  if (gh.subdir) {
    const pre = norm(gh.subdir) + '/';
    files = files.filter((i) => i.path.startsWith(pre)).map((i) => ({ ...i, path: i.path.slice(pre.length) }));
    if (!files.length) throw new InstallError('That folder was not found in the repository.');
  }
  const root = chooseRoot(files.map((f) => f.path));
  if (root === null) throw new InstallError(NO_INDEX);
  if (root) files = files.filter((f) => f.path.startsWith(root + '/')).map((f) => ({ ...f, path: f.path.slice(root.length + 1) }));
  if (files.length > MAX_FILES) throw new InstallError(`Too many files (${files.length}). The limit is ${MAX_FILES}.`);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) throw new InstallError('This app is larger than 400 MB, which is more than a browser can safely store.');

  const rawBase = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${encPath(ref)}/`;
  const out = new Array(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      let blob = null;
      for (let attempt = 0; attempt < 3 && !blob; attempt++) {
        try {
          const r = await fetch(rawBase + encPath(f.full));
          if (r.ok) blob = await r.blob();
          else if (r.status === 404) break;
        } catch {}
      }
      if (!blob) throw new InstallError(`Couldn't download “${f.path}” from GitHub. Try again, or download the ZIP and drop it in.`);
      const type = RAW_TYPES[(f.path.split('.').pop() || '').toLowerCase()];
      if (type) blob = new Blob([blob], { type });
      out[i] = { path: f.path, getBlob: async () => blob };
      onProgress?.(++done / files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return out;
}

export async function readUrlZip(url, onProgress) {
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    throw new InstallError('That is not a valid web address.');
  }
  const blob = await fetchBlob(u.href, onProgress, u.hostname);
  return readZipFile(blob);
}

/* ---------------------------------------------------------------- inspect */
const NO_INDEX =
  "No index.html found. WebOS installs static web apps (HTML/CSS/JS). If this is a React/Vue project, install the built version (usually the 'dist' or 'build' folder).";
const BUILD_DIR = /(^|\/)(dist|build|public|docs)$/;

/** Picks the folder that holds the app: the shallowest index.html, preferring dist/build/docs over source folders. */
export function chooseRoot(paths) {
  const idx = [...new Set(paths.filter((p) => /(^|\/)index\.html?$/i.test(p)).map(dirOf))];
  if (!idx.length) return null;
  const rank = (d) => (BUILD_DIR.test(d) ? 0 : 1);
  return idx.sort((a, b) => depth(a) - depth(b) || rank(a) - rank(b) || a.length - b.length)[0];
}

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const depth = (p) => (p ? p.split('/').length : 0);

/**
 * Works out which folder is the app root (the one holding index.html) and reads metadata.
 * `subdir` forces a root (used for GitHub /tree/branch/folder links).
 */
export async function inspect(files, { subdir = '', fallbackName = '' } = {}) {
  if (!files.length) throw new InstallError('That archive is empty.');
  if (files.length > MAX_FILES) throw new InstallError(`Too many files (${files.length}). The limit is ${MAX_FILES}.`);

  const paths = new Set(files.map((f) => f.path));
  let root = null;
  if (subdir) {
    // GitHub zips wrap everything in "repo-branch/"; subdir is relative to that.
    const top = files[0].path.split('/')[0];
    const cand = norm(top + '/' + subdir);
    if ([...paths].some((p) => p.startsWith(cand + '/'))) root = cand;
  }
  if (root === null) {
    root = chooseRoot(files.map((f) => f.path));
    if (root === null) throw new InstallError(NO_INDEX);
  }
  const prefix = root ? root + '/' : '';
  const inRoot = files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) }));

  const find = (name) => inRoot.find((f) => f.path.toLowerCase() === name);
  const readText = async (f) => (f ? await (await f.getBlob()).text() : '');
  const json = async (f) => {
    try {
      return JSON.parse(await readText(f));
    } catch {
      return null;
    }
  };

  const webosJson = await json(find('webos.json'));
  const pwa = (await json(find('manifest.webmanifest'))) || (await json(find('manifest.json'))) || {};
  const pkg = (await json(find('package.json'))) || {};
  const indexFile = find('index.html') || find('index.htm');
  const html = (await readText(indexFile)).slice(0, 60000);

  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim();
  const meta = (n) =>
    (new RegExp(`<meta[^>]+name=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html) ||
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${n}["']`, 'i').exec(html))?.[1] || '';

  const name =
    (webosJson?.name || pwa.name || pwa.short_name || title || pkg.displayName || prettify(pkg.name) || prettify(fallbackName) || 'Untitled app')
      .toString()
      .slice(0, 60);
  const description = (webosJson?.description || pwa.description || meta('description') || pkg.description || '').toString().slice(0, 240);
  const version = (webosJson?.version || pwa.version || pkg.version || '').toString().slice(0, 20);
  const author = (webosJson?.author || (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name) || '').toString().slice(0, 60);
  const themeColor = (webosJson?.color || pwa.theme_color || meta('theme-color') || '').toString();

  // icon
  const have = (p) => inRoot.find((f) => f.path.toLowerCase() === p.toLowerCase());
  let iconPath = null;
  const wanted = [];
  if (webosJson?.icon) wanted.push(norm(webosJson.icon));
  const sizeOf = (s) => Math.max(0, ...String(s || '0').split(/\s+/).map((x) => parseInt(x) || 0));
  if (Array.isArray(pwa.icons)) {
    [...pwa.icons].sort((a, b) => sizeOf(b.sizes) - sizeOf(a.sizes)).forEach((i) => i?.src && wanted.push(norm(i.src.replace(/^\.?\//, ''))));
  }
  const linkIcon = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(html) || /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/i.exec(html);
  if (linkIcon && !/^(https?:|data:)/i.test(linkIcon[1])) wanted.push(norm(linkIcon[1].replace(/^\.?\//, '').split(/[?#]/)[0]));
  wanted.push('icon.svg', 'icon.png', 'logo.svg', 'logo.png', 'favicon.svg', 'apple-touch-icon.png', 'icon-512.png', 'icon-192.png', 'favicon.png', 'favicon.ico', 'assets/icon.png', 'assets/logo.png', 'images/icon.png', 'img/icon.png');
  for (const w of wanted) {
    const f = have(w);
    if (f && /\.(png|jpe?g|svg|webp|ico|gif)$/i.test(f.path)) {
      iconPath = f.path;
      break;
    }
  }
  const inlineIcon = !iconPath && /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["'](data:image\/[^"']+)["']/i.exec(html)?.[1];

  let size = 0;
  const list = [];
  for (const f of inRoot) {
    const b = await f.getBlob();
    size += b.size;
    if (size > MAX_TOTAL) throw new InstallError('This app is larger than 400 MB, which is more than a browser can safely store.');
    list.push({ path: f.path, size: b.size });
  }
  return {
    files: inRoot,
    list,
    root,
    iconPath,
    inlineIcon: inlineIcon || null,
    meta: {
      name,
      description,
      version,
      author,
      color: /^#[0-9a-f]{3,8}$/i.test(themeColor) ? themeColor : '',
      display: webosJson?.display || (pwa.display === 'fullscreen' ? 'fullscreen' : 'window'),
      width: Number(webosJson?.width) > 0 ? Math.min(2400, Math.max(320, Number(webosJson.width))) : 0,
      height: Number(webosJson?.height) > 0 ? Math.min(1600, Math.max(240, Number(webosJson.height))) : 0,
    },
    fileCount: list.length,
    size,
  };
}

function prettify(s) {
  if (!s) return '';
  return String(s)
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/* ---------------------------------------------------------------- install */
export async function uniqueId(name) {
  const used = new Set((await listApps()).map((a) => a.id));
  const base = slug(name);
  let id = base;
  for (let i = 2; used.has(id); i++) id = base + '-' + i;
  return id;
}

const IMG = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' };
export const mimeFor = (p) => IMG[(p.split('.').pop() || '').toLowerCase()] || 'image/png';

async function makeIconBlob(info) {
  if (info.iconPath) {
    const f = info.files.find((x) => x.path === info.iconPath);
    if (f) return new Blob([await f.getBlob()], { type: mimeFor(f.path) });
  }
  if (info.inlineIcon) {
    try {
      return await (await fetch(info.inlineIcon)).blob();
    } catch {}
  }
  return null;
}

/**
 * Installs (or updates when `replaceId` is given). Returns the stored app record.
 * Files are read one by one so memory stays low on big apps.
 */
export async function install(info, { name, source = 'zip', sourceUrl = '', replaceId = null, onProgress } = {}) {
  const old = replaceId ? await getApp(replaceId) : null;
  const id = replaceId || (await uniqueId(name || info.meta.name));
  const files = [];
  let i = 0;
  for (const f of info.files) {
    const blob = await f.getBlob();
    files.push({ path: f.path, size: blob.size, blob });
    onProgress?.(++i / info.files.length);
  }
  let icon = await makeIconBlob(info);
  if (icon && icon.size > 600 * 1024) icon = null;
  const app = {
    id,
    name: (name || info.meta.name).slice(0, 60),
    description: info.meta.description,
    version: info.meta.version,
    author: info.meta.author,
    color: info.meta.color,
    display: info.meta.display,
    width: info.meta.width,
    height: info.meta.height,
    icon: icon ? new Blob([icon], { type: icon.type || 'image/png' }) : old?.icon || null,
    size: info.size,
    fileCount: info.fileCount,
    source,
    sourceUrl,
    installedAt: old?.installedAt || Date.now(),
    updatedAt: Date.now(),
    lastOpened: old?.lastOpened || 0,
    openCount: old?.openCount || 0,
    pinned: old?.pinned || false,
  };
  await saveAppWithFiles(app, files);
  return app;
}

/* ------------------------------------------------------------------ backup */
export async function exportAppZip(app) {
  const zip = new JSZip();
  for (const f of await getAppFiles(app.id)) zip.file(f.path, f.blob);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Full backup: every app (zipped) plus metadata, as one .webos file (a ZIP). */
export async function exportBackup(settingsObj, onProgress) {
  const apps = await listApps();
  const zip = new JSZip();
  const manifest = { webos: 1, created: Date.now(), settings: settingsObj, apps: [] };
  let n = 0;
  for (const app of apps) {
    const { icon, ...rec } = app;
    manifest.apps.push(rec);
    for (const f of await getAppFiles(app.id)) zip.file(`apps/${app.id}/files/${f.path}`, f.blob);
    if (icon) zip.file(`apps/${app.id}/icon`, icon);
    onProgress?.(++n / Math.max(1, apps.length));
  }
  zip.file('webos-backup.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export async function importBackup(file, onProgress) {
  const zip = await JSZip.loadAsync(file).catch(() => {
    throw new InstallError('This is not a WebOS backup file.');
  });
  const mf = zip.file('webos-backup.json');
  if (!mf) throw new InstallError('This is not a WebOS backup file.');
  const data = JSON.parse(await mf.async('string'));
  let n = 0;
  for (const rec of data.apps || []) {
    const files = [];
    const base = `apps/${rec.id}/files/`;
    const entries = [];
    zip.forEach((p, e) => {
      if (!e.dir && p.startsWith(base)) entries.push([p, e]);
    });
    for (const [p, e] of entries) {
      const blob = await e.async('blob');
      files.push({ path: p.slice(base.length), size: blob.size, blob });
    }
    const iconEntry = zip.file(`apps/${rec.id}/icon`);
    rec.icon = iconEntry ? await iconEntry.async('blob') : null;
    await saveAppWithFiles(rec, files);
    onProgress?.(++n / data.apps.length);
  }
  return { settings: data.settings || null, count: (data.apps || []).length };
}

export { deleteApp, putApp, listApps, getApp };
