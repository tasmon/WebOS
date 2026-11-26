/* WebOS service worker
 *  1. Serves installed apps from IndexedDB under /apps/<id>/...
 *  2. Injects a small compatibility layer into each app's HTML (per-app storage, WebOS API)
 *  3. Keeps the WebOS shell available offline (network first, cache fallback)
 */
'use strict';

const VERSION = '1.0.0';
const SHELL_CACHE = 'webos-shell-' + VERSION;
// Keep in sync with the files in the repository.
const SHELL = [
  '/', '/index.html', '/style.css', '/main.js', '/config.js', '/icons.js', '/ui.js', '/db.js', '/tile.js',
  '/settings.js', '/wallpaper.js', '/pwa.js', '/wm.js', '/installer.js', '/install-ui.js',
  '/app-manager.js', '/app-settings.js', '/app-about.js', '/jszip.min.js', '/icon.svg', '/icon-192.png',
  '/icon-512.png', '/icon-maskable-512.png', '/manifest.webmanifest',
];

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', eot: 'application/vnd.ms-fontobject', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8', pdf: 'application/pdf', wasm: 'application/wasm', zip: 'application/zip',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
};

/* ------------------------------------------------------------- database */
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('webos', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('apps')) db.createObjectStore('apps', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    r.onerror = () => { dbPromise = null; reject(r.error); };
  });
  return dbPromise;
}
async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const q = db.transaction(store).objectStore(store).get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
const getFile = (id, path) => dbGet('files', id + '/' + path);
const getApp = (id) => dbGet('apps', id);

/* ------------------------------------------------------------ lifecycle */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('webos-shell-') && k !== SHELL_CACHE) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

/* ---------------------------------------------------------------- fetch */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(route(event, url));
});

async function route(event, url) {
  const req = event.request;
  const m = /^\/apps\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (m) {
    if (!m[2]) return Response.redirect('/apps/' + m[1] + '/' + url.search, 302);
    return serveApp(m[1], m[2], req, url, true);
  }
  // A request made by an app page using a root-relative path (e.g. "/css/site.css")
  const appId = await originApp(event, req);
  if (appId) {
    const r = await serveApp(appId, url.pathname, req, url, false);
    if (r) return r;
  }
  return shell(req);
}

async function originApp(event, req) {
  const fromUrl = (u) => {
    try {
      const x = new URL(u);
      if (x.origin !== self.location.origin) return null;
      const mm = /^\/apps\/([^/]+)\//.exec(x.pathname);
      return mm ? mm[1] : null;
    } catch (e) { return null; }
  };
  let id = req.referrer && req.referrer !== 'about:client' ? fromUrl(req.referrer) : null;
  if (!id && event.clientId) {
    const c = await self.clients.get(event.clientId);
    if (c) id = fromUrl(c.url);
  }
  return id;
}

const appPath = (id, p) => '/apps/' + id + '/' + p.split('/').map(encodeURIComponent).join('/');
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

async function serveApp(appId, rel, req, url, direct) {
  let path = safeDecode(rel).replace(/^\/+/, '');
  const endsSlash = path === '' || path.endsWith('/');
  const lastSeg = path.split('/').pop();
  if (endsSlash) path += 'index.html';
  let file = await getFile(appId, path);
  let status = 200;

  if (!file) {
    const base = path.replace(/\/+$/, '');
    if (!endsSlash && (await getFile(appId, base + '/index.html'))) {
      // directory without trailing slash -> redirect so relative URLs resolve
      return Response.redirect(appPath(appId, base) + '/' + url.search, 301);
    }
    if (!endsSlash) file = (await getFile(appId, base + '.html')) || null; // "clean URLs"
    if (!file && !direct) return null;
    if (!file) {
      const wantsPage = req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe';
      const hasExt = /\.[a-z0-9]{1,8}$/i.test(lastSeg);
      if (wantsPage && !hasExt) {
        file = await getFile(appId, 'index.html'); // single-page-app fallback
      } else if (wantsPage) {
        const nf = await getFile(appId, '404.html');
        if (nf) { file = nf; status = 404; }
      }
      if (!file) {
        const app = await getApp(appId);
        return notFound(app ? 'File not found: /' + path : 'This app is not installed.', wantsPage);
      }
    }
  }
  return fileResponse(file, appId, req, status);
}

async function fileResponse(file, appId, req, status) {
  const ext = (file.path.split('.').pop() || '').toLowerCase();
  const type = MIME[ext] || (file.blob && file.blob.type) || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
  const isDoc = req.mode === 'navigate' || ['document', 'iframe', 'frame', 'embed', 'object'].includes(req.destination);

  if ((ext === 'html' || ext === 'htm') && isDoc) {
    const app = (await getApp(appId)) || { id: appId, name: appId };
    const html = await file.blob.text();
    return new Response(transformHtml(html, app), { status, headers });
  }

  const range = req.headers.get('range');
  if (range && status === 200) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      const size = file.blob.size;
      let start, end;
      if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
      else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      return new Response(file.blob.slice(start, end + 1), {
        status: 206,
        headers: Object.assign({}, headers, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': String(end - start + 1) }),
      });
    }
  }
  return new Response(file.blob, { status, headers });
}

function notFound(message, asPage) {
  if (!asPage) return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const esc = message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title>' +
      '<body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#10131a;color:#e8ebf3;text-align:center">' +
      '<div><div style="font-size:48px">🗂️</div><h1 style="font-size:20px;margin:.5em 0">404</h1><p style="opacity:.7">' + esc(message) + '</p></div>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

/* ----------------------------------------------------------- HTML rewrite */
function transformHtml(html, app) {
  const prefix = '/apps/' + app.id + '/';
  // Root-relative URLs ("/css/a.css") would escape the app: point them back inside it.
  html = html.replace(/<[a-zA-Z][^>]*>/g, (tag) =>
    tag.replace(/(\s(?:src|href|action|poster|data|formaction)\s*=\s*)(["'])\/(?!\/)/gi, '$1$2' + prefix)
  );
  const cfg = JSON.stringify({ id: app.id, name: app.name || app.id, os: VERSION }).replace(/</g, '\\u003c');
  const tag = '<script>(' + appShim.toString() + ')(' + cfg + ');</script>';
  let m;
  if ((m = /<head(\s[^>]*)?>/i.exec(html))) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
  if ((m = /<html(\s[^>]*)?>/i.exec(html))) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
  if ((m = /^\s*<!doctype[^>]*>/i.exec(html))) return html.slice(0, m[0].length) + tag + html.slice(m[0].length);
  return tag + html;
}

/* This function is serialised and injected into every app page. Plain ES5 on purpose. */
function appShim(APP) {
  'use strict';
  if (window.__webosShim) return;
  window.__webosShim = true;
  var P = 'webos:' + APP.id + ':';
  var inFrame = window.parent !== window;

  function wrapStorage(real) {
    function keys() {
      var out = [];
      for (var i = 0; i < real.length; i++) {
        var k = real.key(i);
        if (k && k.indexOf(P) === 0) out.push(k.slice(P.length));
      }
      return out;
    }
    var api = {
      getItem: function (k) { return real.getItem(P + k); },
      setItem: function (k, v) { real.setItem(P + k, String(v)); },
      removeItem: function (k) { real.removeItem(P + k); },
      clear: function () { keys().forEach(function (k) { real.removeItem(P + k); }); },
      key: function (i) { var ks = keys(); return i >= 0 && i < ks.length ? ks[i] : null; },
    };
    return new Proxy(api, {
      get: function (t, p) {
        if (p === 'length') return keys().length;
        if (typeof p === 'symbol' || Object.prototype.hasOwnProperty.call(t, p)) return t[p];
        var v = t.getItem(p);
        return v === null ? undefined : v;
      },
      set: function (t, p, v) { t.setItem(p, v); return true; },
      deleteProperty: function (t, p) { t.removeItem(p); return true; },
      has: function (t, p) { return Object.prototype.hasOwnProperty.call(t, p) || t.getItem(p) !== null; },
      ownKeys: function () { return keys(); },
      getOwnPropertyDescriptor: function (t, p) {
        if (typeof p === 'symbol') return undefined;
        var v = t.getItem(p);
        return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
  }
  try {
    var ls = wrapStorage(window.localStorage);
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return ls; } });
  } catch (e) {}
  try {
    var ss = wrapStorage(window.sessionStorage);
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return ss; } });
  } catch (e) {}

  try {
    var open = IDBFactory.prototype.open, del = IDBFactory.prototype.deleteDatabase, dbs = IDBFactory.prototype.databases;
    IDBFactory.prototype.open = function (name, version) {
      return arguments.length > 1 ? open.call(this, P + name, version) : open.call(this, P + name);
    };
    IDBFactory.prototype.deleteDatabase = function (name) { return del.call(this, P + name); };
    if (dbs) {
      IDBFactory.prototype.databases = function () {
        return dbs.call(this).then(function (list) {
          return list.filter(function (d) { return d.name.indexOf(P) === 0; })
            .map(function (d) { return { name: d.name.slice(P.length), version: d.version }; });
        });
      };
    }
  } catch (e) {}

  // Apps cannot register their own service workers inside WebOS (WebOS already serves them).
  try {
    ServiceWorkerContainer.prototype.register = function () {
      return Promise.reject(new DOMException('Service workers are disabled for apps running inside WebOS.', 'SecurityError'));
    };
  } catch (e) {}

  /* ---- WebOS API ---- */
  function send(m) {
    if (!inFrame) return;
    m.webos = 1;
    m.appId = APP.id;
    try { parent.postMessage(m, location.origin); } catch (e) {}
  }
  var api = {
    id: APP.id,
    name: APP.name,
    osVersion: APP.os,
    embedded: inFrame,
    theme: null,
    accent: null,
    notify: function (title, body) { send({ type: 'notify', title: String(title == null ? '' : title), body: String(body == null ? '' : body) }); },
    close: function () { send({ type: 'close' }); },
    setTitle: function (t) { send({ type: 'title', title: String(t) }); },
  };
  window.WebOS = api;
  function applyEnv(env) {
    if (!env) return;
    api.theme = env.theme;
    api.accent = env.accent;
    var de = document.documentElement;
    if (de) {
      if (env.theme) de.setAttribute('data-webos-theme', env.theme);
      if (env.accent) de.style.setProperty('--webos-accent', env.accent);
    }
    try { window.dispatchEvent(new CustomEvent('webos:env', { detail: env })); } catch (e) {}
  }
  if (inFrame) {
    try {
      var pd = window.parent.document.documentElement;
      applyEnv({ theme: pd.getAttribute('data-theme'), accent: window.parent.getComputedStyle(pd).getPropertyValue('--accent').trim() });
    } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source === window.parent && e.data && e.data.webos && e.data.type === 'env') applyEnv(e.data);
    });
    window.addEventListener('pointerdown', function () { send({ type: 'focus' }); }, true);
    window.addEventListener('keydown', function (e) {
      if ((e.altKey && !e.ctrlKey) || e.key === 'Escape')
        send({ type: 'key', key: e.key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
    }, true);
  }
}

/* ------------------------------------------------------------ the shell */
async function shell(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (req.method === 'GET' && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const idx = await cache.match('/index.html');
      if (idx) return idx;
    }
    return new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}
