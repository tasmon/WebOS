'use strict';
/* WebOS Store API: one Vercel function that handles every /api/* request.
 *
 * Needs (set in Vercel -> Settings -> Environment Variables):
 *   ADMIN_PASSWORD        your admin password for /admin            (required)
 *   Upstash Redis         added from Vercel -> Storage; it sets KV_REST_API_URL and KV_REST_API_TOKEN for you
 *   GITHUB_TOKEN          optional, raises GitHub's rate limit when checking submitted repositories
 *   ADMIN_EMAIL           optional, defaults to tasmon@outlook.com
 *   SESSION_SECRET        optional, any long random text; defaults to a value derived from the database token
 *
 * No npm packages are used.
 *
 * Deploy as api/index.js together with the vercel.json rewrite that sends every /api/* request here.
 */
const crypto = require('crypto');

/* ================================================================= config */
// Vercel lets you choose a prefix when connecting a database (for example STORAGE_KV_REST_API_URL), so accept any prefix.
const envBy = (names, rx) => {
  for (const n of names) if (process.env[n]) return process.env[n];
  const k = Object.keys(process.env).find((x) => rx.test(x) && !/READ_ONLY/.test(x) && process.env[x]);
  return k ? process.env[k] : '';
};
const cfg = () => ({
  url: envBy(['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'], /(KV_REST_API_URL|REDIS_REST_URL|_REST_API_URL)$/),
  token: envBy(['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'], /(KV_REST_API_TOKEN|REDIS_REST_TOKEN|_REST_API_TOKEN)$/),
  adminEmail: (process.env.ADMIN_EMAIL || 'tasmon@outlook.com').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  github: process.env.GITHUB_TOKEN || '',
  secret: process.env.SESSION_SECRET || '',
});
const secretKey = () => crypto.createHash('sha256').update('webos-store:' + (cfg().secret || cfg().token)).digest();

const CATEGORIES = ['Productivity', 'Utilities', 'Games', 'Education', 'Developer tools', 'Design', 'Media', 'Finance', 'Health', 'Other'];
const QUESTIONS = [
  { id: 'q1', text: 'What was the name of your first pet?' },
  { id: 'q2', text: 'In what city were you born?' },
  { id: 'q3', text: 'What was the name of your first school?' },
  { id: 'q4', text: "What is your mother's maiden name?" },
  { id: 'q5', text: 'What was your childhood nickname?' },
  { id: 'q6', text: 'What is the name of your favourite teacher?' },
  { id: 'q7', text: 'What was the make of your first phone?' },
  { id: 'q8', text: 'What street did you grow up on?' },
  { id: 'q9', text: 'What is your favourite book?' },
  { id: 'q10', text: 'What was the name of your best childhood friend?' },
];
const QTEXT = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.text]));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const REVIEW_STREAK = 5; // approved apps in a row needed to ask for a reviewer account
const COOKIE_USER = 'webos_session';
const COOKIE_ADMIN = 'webos_admin';
const USER_TTL = 30 * 24 * 3600;
const ADMIN_TTL = 4 * 3600;

/* ================================================================= helpers */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}
const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};
const clean = (v, max) =>
  String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
const isEmail = (e) => e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@.]{2,}$/.test(e);
/** Cleans a website address. Only public https addresses are accepted. soft=true returns '' instead of failing. */
function cleanUrl(input, soft) {
  let v = clean(input, 300);
  if (!v) return '';
  const bad = (m) => (soft ? '' : fail(400, m));
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
  let u;
  try {
    u = new URL(v);
  } catch (e) {
    return bad('Enter a valid website address, for example example.com.');
  }
  if (!/^https?:$/.test(u.protocol)) return bad('Only http and https website addresses can be used.');
  const host = u.hostname.toLowerCase();
  if (u.username || u.password) return bad('The address cannot contain a user name or password.');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[') || /\.(local|internal|localhost|lan|home)$/.test(host) || host === 'localhost') return bad('Use a public website address such as example.com.');
  u.protocol = 'https:';
  u.hash = '';
  return u.href;
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
const now = () => Date.now();
const round1 = (n) => Math.round(n * 10) / 10;

function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
}

/* ================================================================= redis (Upstash REST) */
async function pipe(cmds) {
  const c = cfg();
  if (!c.url || !c.token) fail(503, 'The store database is not connected yet.', { code: 'no_db' });
  let r;
  try {
    r = await fetch(c.url.replace(/\/+$/, '') + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
  } catch (e) {
    fail(502, 'Could not reach the store database.');
  }
  if (!r.ok) fail(502, 'The store database returned an error.');
  const out = await r.json();
  return out.map((x) => {
    if (x && x.error) throw new Error('redis: ' + x.error);
    return x ? x.result : null;
  });
}
const R = async (...args) => (await pipe([args]))[0];
const toObj = (r) => {
  if (!r) return {};
  if (!Array.isArray(r)) return r;
  const o = {};
  for (let i = 0; i < r.length; i += 2) o[r[i]] = r[i + 1];
  return o;
};
const jget = async (k) => {
  const v = await R('GET', k);
  return v ? JSON.parse(v) : null;
};
const jset = (k, v) => R('SET', k, JSON.stringify(v));

/* ================================================================= passwords, tokens, cookies */
const scrypt = (value, salt) =>
  new Promise((resolve, reject) => crypto.scrypt(String(value), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))));
async function hashSecret(value) {
  const salt = crypto.randomBytes(16);
  return { s: salt.toString('base64'), h: (await scrypt(value, salt)).toString('base64') };
}
async function checkSecret(value, rec) {
  const k = await scrypt(value, Buffer.from(rec.s, 'base64'));
  const h = Buffer.from(rec.h, 'base64');
  return h.length === k.length && crypto.timingSafeEqual(h, k);
}
let dummy = null;
const dummyRecord = async () => dummy || (dummy = await hashSecret('not-a-real-password'));
const normAnswer = (a) => String(a || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  return body + '.' + crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && p.exp > now() ? p : null;
  } catch (e) {
    return null;
  }
}
function parseCookies(req) {
  const out = {};
  String((req.headers && req.headers.cookie) || '')
    .split(';')
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
  return out;
}
function setCookie(res, name, value, maxAge, path) {
  (res._cookies = res._cookies || []).push(`${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=${maxAge}`);
}
const login = (res, user) => setCookie(res, COOKIE_USER, sign({ role: 'user', sub: user.email, sv: user.sv, exp: now() + USER_TTL * 1000 }), USER_TTL, '/');
const logout = (res) => setCookie(res, COOKIE_USER, '', 0, '/');

async function userFrom(req) {
  const p = verifyToken(parseCookies(req)[COOKIE_USER]);
  if (!p || p.role !== 'user') return null;
  const u = await jget('user:' + p.sub);
  return u && u.sv === p.sv ? u : null;
}
async function needUser(req) {
  const u = await userFrom(req);
  if (!u) fail(401, 'Please sign in first.');
  return u;
}
function needAdmin(req) {
  const p = verifyToken(parseCookies(req)[COOKIE_ADMIN]);
  if (!p || p.role !== 'admin' || p.sub !== cfg().adminEmail) fail(401, 'Admin sign-in required.');
  return p;
}
const publicUser = (u) => ({
  email: u.email,
  name: u.name,
  created: u.created,
  reviewer: !!u.reviewer,
  streak: u.streak || 0,
  reviewerRequested: !!u.revReq,
  reviewerDeniedUntil: u.revDeniedAt && now() < u.revDeniedAt + 7 * 864e5 ? u.revDeniedAt + 7 * 864e5 : 0,
});

/* ================================================================= rate limits */
async function limit(name, key, max, windowSec, message) {
  const k = `rl:${name}:${key}`;
  const [n, ttl] = await pipe([['INCR', k], ['TTL', k]]);
  if (ttl < 0) await R('EXPIRE', k, windowSec);
  if (n > max) fail(429, message || 'Too many attempts. Please wait a little and try again.');
}
const failCount = async (k) => Number(await R('GET', k)) || 0;
async function failBump(k, windowSec) {
  const [, ttl] = await pipe([['INCR', k], ['TTL', k]]);
  if (ttl < 0) await R('EXPIRE', k, windowSec);
}

/* ================================================================= GitHub */
async function ghGet(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'WebOS-Store' };
  if (cfg().github) headers.Authorization = 'Bearer ' + cfg().github;
  return fetch('https://api.github.com' + path, { headers, signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined });
}
function parseRepo(input) {
  const s = clean(input, 300);
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^/?#]+)(?:\/([^?#]*?))?)?\/?(?:[?#].*)?$/i.exec(s);
  if (!m) m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(s);
  if (!m || ['.', '..'].includes(m[1]) || ['.', '..'].includes(m[2])) fail(400, 'Enter a GitHub repository like owner/repo or a github.com link.');
  const subdir = (m[4] || '').split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
  return { owner: m[1], repo: m[2], ref: m[3] ? decodeURIComponent(m[3]) : '', subdir };
}
const SKIP = /(^|\/)(__MACOSX|\.git|\.github|\.vscode|\.idea|node_modules)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$/i;
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const depth = (p) => (p ? p.split('/').length : 0);
function chooseRoot(paths) {
  const idx = [...new Set(paths.filter((p) => /(^|\/)index\.html?$/i.test(p)).map(dirOf))];
  if (!idx.length) return null;
  const rank = (d) => (/(^|\/)(dist|build|public|docs)$/.test(d) ? 0 : 1);
  return idx.sort((a, b) => depth(a) - depth(b) || rank(a) - rank(b) || a.length - b.length)[0];
}
const ICON_NAMES = ['icon.svg', 'icon.png', 'logo.svg', 'logo.png', 'favicon.svg', 'apple-touch-icon.png', 'icon-512.png', 'icon-192.png', 'favicon.png', 'assets/icon.png', 'assets/logo.png', 'images/icon.png', 'img/icon.png'];
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

/** Checks the repository on GitHub. Public repos only; must contain an index.html. */
async function verifyRepo(input) {
  const want = typeof input === 'string' ? parseRepo(input) : input;
  const out = {
    owner: want.owner,
    repo: want.repo,
    ref: want.ref || '',
    subdir: want.subdir || '',
    description: '',
    stars: 0,
    license: '',
    publisher: want.owner,
    publisherName: want.owner,
    publisherUrl: 'https://github.com/' + want.owner,
    avatar: `https://github.com/${encodeURIComponent(want.owner)}.png?size=96`,
    iconUrl: '',
    verified: false,
    noIndex: false,
    homepage: '',
    pagesUrl: '',
    files: 0,
    size: 0,
  };
  let r;
  try {
    r = await ghGet(`/repos/${encodeURIComponent(want.owner)}/${encodeURIComponent(want.repo)}`);
  } catch (e) {
    return out; // GitHub unreachable: keep it for manual review
  }
  if (r.status === 404) fail(400, 'That repository was not found. It must be public and spelled correctly.');
  if (r.status === 403 || r.status === 429) return out; // rate limited: the admin will check it by hand
  if (!r.ok) return out;
  const repo = await r.json();
  if (repo.private) fail(400, 'That repository is private. Only public repositories can be listed.');
  out.owner = repo.owner.login;
  out.repo = repo.name;
  out.description = clean(repo.description || '', 300);
  out.stars = repo.stargazers_count || 0;
  out.homepage = cleanUrl(repo.homepage || '', true);
  if (repo.has_pages) out.pagesUrl = `https://${repo.owner.login.toLowerCase()}.github.io/${repo.name.toLowerCase() === repo.owner.login.toLowerCase() + '.github.io' ? '' : repo.name + '/'}`;
  out.license = (repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION' && repo.license.spdx_id) || '';
  out.publisher = repo.owner.login;
  out.publisherName = repo.owner.login;
  out.publisherUrl = repo.owner.html_url || out.publisherUrl;
  if (repo.owner.avatar_url && /^https:\/\/avatars\.githubusercontent\.com\//.test(repo.owner.avatar_url)) out.avatar = repo.owner.avatar_url + (repo.owner.avatar_url.includes('?') ? '&' : '?') + 's=96';
  const ref = out.ref || repo.default_branch || 'main';

  // publisher's display name, as shown on their GitHub profile
  try {
    const u = await ghGet('/users/' + encodeURIComponent(repo.owner.login));
    if (u.ok) {
      const uj = await u.json();
      if (uj.name) out.publisherName = clean(uj.name, 60);
    }
  } catch (e) {}

  try {
    const t = await ghGet(`/repos/${encodeURIComponent(out.owner)}/${encodeURIComponent(out.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (t.status === 404) fail(400, 'That branch was not found in the repository.');
    if (t.ok) {
      const tj = await t.json();
      let files = (tj.tree || []).filter((x) => x.type === 'blob' && !SKIP.test(x.path)).map((x) => ({ path: x.path, size: x.size || 0 }));
      if (out.subdir) {
        const pre = out.subdir + '/';
        files = files.filter((f) => f.path.startsWith(pre)).map((f) => ({ ...f, path: f.path.slice(pre.length) }));
        if (!files.length) fail(400, 'That folder was not found in the repository.');
      }
      const root = chooseRoot(files.map((f) => f.path));
      if (root === null) {
        // no index.html: the app runs online (GitHub Pages, Vercel, ...), so it can only be added as a web shortcut
        out.noIndex = true;
        out.verified = true;
        return out;
      }
      const inRoot = root ? files.filter((f) => f.path.startsWith(root + '/')).map((f) => ({ ...f, path: f.path.slice(root.length + 1) })) : files;
      out.files = inRoot.length;
      out.size = inRoot.reduce((n, f) => n + f.size, 0);
      if (out.files > 6000 || out.size > 400 * 1024 * 1024) fail(400, 'That app is too large to install in a browser (limit: 6000 files / 400 MB).');
      const lower = new Map(inRoot.map((f) => [f.path.toLowerCase(), f.path]));
      const iconFile = ICON_NAMES.map((n) => lower.get(n)).find(Boolean);
      if (iconFile) out.iconUrl = `https://raw.githubusercontent.com/${encodeURIComponent(out.owner)}/${encodeURIComponent(out.repo)}/${encPath(ref)}/${encPath((root ? root + '/' : '') + (out.subdir ? out.subdir + '/' : '') + iconFile)}`;
      out.verified = true;
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  return out;
}

/* ================================================================= store data */
const appId = (r) => [r.owner, r.repo, r.subdir && slug(r.subdir)].filter(Boolean).join('--').toLowerCase();
let cache = { t: 0, list: null };
const invalidate = () => (cache = { t: 0, list: null });

function pubApp(a, s = {}) {
  const rcnt = Number(s.rcnt) || 0;
  return {
    id: a.id,
    owner: a.owner,
    repo: a.repo,
    ref: a.ref || null,
    subdir: a.subdir || '',
    title: a.title,
    description: a.description,
    category: a.category,
    publisher: a.publisher,
    publisherName: a.publisherName,
    publisherUrl: a.publisherUrl,
    avatar: a.avatar,
    stars: a.stars || 0,
    license: a.license || '',
    iconUrl: a.iconUrl || '',
    featured: !!a.featured,
    kind: a.kind === 'link' ? 'link' : 'repo',
    url: a.kind === 'link' ? a.url || '' : '',
    approvedAt: a.approvedAt || 0,
    downloads: Number(s.dl) || 0,
    rating: rcnt ? round1(Number(s.rsum) / rcnt) : 0,
    ratingCount: rcnt,
  };
}
async function loadApps(ids) {
  if (!ids.length) return [];
  const cmds = [];
  ids.forEach((id) => cmds.push(['GET', 'app:' + id], ['HGETALL', 'stats:' + id]));
  const res = await pipe(cmds);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    if (!res[i * 2]) continue;
    out.push({ app: JSON.parse(res[i * 2]), stats: toObj(res[i * 2 + 1]) });
  }
  return out;
}
async function approvedList() {
  if (cache.list && now() - cache.t < 15000) return cache.list;
  const ids = (await R('SMEMBERS', 'apps:approved')) || [];
  const list = (await loadApps(ids)).filter((x) => x.app.status === 'approved').map((x) => pubApp(x.app, x.stats));
  cache = { t: now(), list };
  return list;
}
async function recalc(id) {
  const all = toObj(await R('HGETALL', 'rev:' + id));
  let sum = 0;
  let n = 0;
  for (const v of Object.values(all)) {
    try {
      sum += JSON.parse(v).r;
      n++;
    } catch (e) {}
  }
  await R('HSET', 'stats:' + id, 'rsum', sum, 'rcnt', n);
}
async function allAppIds() {
  const sets = await pipe([['SMEMBERS', 'apps:pending'], ['SMEMBERS', 'apps:approved'], ['SMEMBERS', 'apps:rejected']]);
  return [...new Set([].concat(...sets.map((s) => s || [])))];
}
async function purgeUser(email) {
  for (const id of await allAppIds()) {
    if ((await R('HDEL', 'rev:' + id, email)) > 0) await recalc(id);
  }
  const fbIds = (await R('SMEMBERS', 'fbuser:' + email)) || [];
  await pipe([
    ['DEL', 'user:' + email], ['SREM', 'users', email], ['DEL', 'usersubs:' + email], ['SREM', 'reviewreq', email], ['SREM', 'reviewers', email], ['DEL', 'fbuser:' + email],
    ...fbIds.flatMap((id) => [['DEL', 'fb:' + id], ['SREM', 'fb:new', id], ['SREM', 'fb:done', id]]),
  ]);
  invalidate();
}
const hostName = (u) => new URL(u).hostname.replace(/^www\./, '');
const linkId = (u) => 'link--' + slug(hostName(u) + new URL(u).pathname).slice(0, 28) + '-' + sha(u.toLowerCase()).slice(0, 6);
const siteIcon = (u) => new URL(u).origin + '/favicon.ico';
/** Builds a new Store record from a submission. Returns { app, verified }. `by` is the user, or null when the admin adds it. */
async function createApp(b, by) {
  const listing = validateListing(b);
  const given = b.url ? cleanUrl(b.url) : '';
  let app;
  let verified = false;
  if (b.kind === 'link') {
    if (!given) fail(400, 'Enter the website address.');
    if (!listing.title) fail(400, 'Give the app a name.');
    const host = hostName(given);
    app = {
      id: linkId(given), kind: 'link', url: given, owner: '', repo: '', ref: '', subdir: '', title: listing.title, description: listing.description, category: listing.category,
      publisher: host, publisherName: host, publisherUrl: new URL(given).origin, avatar: '', stars: 0, license: '', iconUrl: siteIcon(given), verified: false, files: 0, size: 0,
    };
  } else {
    const info = await verifyRepo(b.repo);
    verified = info.verified;
    const base = {
      owner: info.owner, repo: info.repo, ref: info.ref, subdir: info.subdir, title: listing.title || info.repo, description: listing.description, category: listing.category,
      publisher: info.publisher, publisherName: info.publisherName, publisherUrl: info.publisherUrl, avatar: info.avatar, stars: info.stars, license: info.license,
      verified: info.verified, files: info.files, size: info.size,
    };
    if (info.noIndex) {
      const url = given || info.homepage || info.pagesUrl;
      if (!url) fail(400, 'This repository has no index.html. If the app runs online (GitHub Pages, Vercel or similar), enter its website address too and it will be listed as a web app.', { code: 'needs_url' });
      app = { ...base, id: appId(info), kind: 'link', url, iconUrl: siteIcon(url) };
    } else app = { ...base, id: appId(info), kind: 'repo', iconUrl: info.iconUrl };
  }
  Object.assign(app, {
    status: by ? 'pending' : 'approved',
    submittedBy: by ? by.email : cfg().adminEmail,
    submittedByName: by ? by.name : 'Admin',
    submittedAt: now(),
    approvedAt: by ? 0 : now(),
    decidedBy: by ? '' : 'admin',
    note: '',
    featured: false,
  });
  return { app, verified };
}
function validateListing(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.title !== undefined) {
    out.title = clean(b.title, 60);
    if (out.title && out.title.length < 2) fail(400, 'The name must be at least 2 characters.');
  }
  if (!partial || b.description !== undefined) {
    out.description = clean(b.description, 500);
    if (out.description.length < 20) fail(400, 'Please describe the app in at least 20 characters.');
  }
  if (!partial || b.category !== undefined) {
    out.category = CATEGORIES.includes(b.category) ? b.category : 'Other';
  }
  return out;
}

/* ================================================================= routes */
const ROUTES = [];
const route = (method, path, fn) => ROUTES.push({ method, parts: path.split('/'), fn });

/* ---- health ---- */
route('GET', 'health', async () => ({ ok: true, db: !!(cfg().url && cfg().token), adminPassword: !!cfg().adminPassword, githubToken: !!cfg().github }));
route('GET', 'store/meta', async () => ({ categories: CATEGORIES, questions: QUESTIONS, reviewStreak: REVIEW_STREAK }));

/* ---- accounts ---- */
route('POST', 'auth/register', async (req, res, b, ctx) => {
  await limit('reg', ctx.ipHash, 10, 3600, 'Too many accounts created from this network. Please try again later.');
  const email = clean(b.email, 254).toLowerCase();
  const name = clean(b.name, 40);
  const password = String(b.password || '');
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  if (name.length < 2) fail(400, 'Enter a display name (at least 2 characters).');
  if (password.length < 8 || password.length > 128) fail(400, 'Choose a password of 8 to 128 characters.');
  const qs = Array.isArray(b.questions) ? b.questions : [];
  if (qs.length < 2 || qs.length > 3) fail(400, 'Choose 2 or 3 security questions.');
  const ids = new Set();
  for (const q of qs) {
    if (!q || typeof q.id !== 'string' || !has(QTEXT, q.id) || ids.has(q.id)) fail(400, 'Choose different security questions.');
    ids.add(q.id);
    if (normAnswer(q.answer).length < 2 || String(q.answer).length > 100) fail(400, 'Each security answer needs at least 2 characters.');
  }
  if (email === cfg().adminEmail) fail(409, 'That email address cannot be used for a normal account.');
  if (await R('EXISTS', 'user:' + email)) fail(409, 'An account with this email already exists. Try signing in.');
  const user = {
    email,
    name,
    pass: await hashSecret(password),
    qs: await Promise.all(qs.map(async (q) => ({ id: q.id, ...(await hashSecret(normAnswer(q.answer))) }))),
    sv: 1,
    created: now(),
  };
  await jset('user:' + email, user);
  await R('SADD', 'users', email);
  login(res, user);
  return { user: publicUser(user) };
});

route('POST', 'auth/login', async (req, res, b, ctx) => {
  const email = clean(b.email, 254).toLowerCase();
  await limit('login-ip', ctx.ipHash, 40, 900);
  await limit('login-email', sha(email), 10, 900, 'Too many sign-in attempts for this account. Please wait 15 minutes.');
  const user = isEmail(email) ? await jget('user:' + email) : null;
  const ok = await checkSecret(String(b.password || ''), user ? user.pass : await dummyRecord());
  if (!user || !ok) fail(401, 'Wrong email or password.');
  await R('DEL', 'rl:login-email:' + sha(email));
  login(res, user);
  return { user: publicUser(user) };
});
route('POST', 'auth/logout', async (req, res) => (logout(res), { ok: true }));
route('GET', 'auth/me', async (req) => {
  const u = await userFrom(req);
  return { user: u ? publicUser(u) : null };
});

route('POST', 'auth/questions', async (req, res, b, ctx) => {
  await limit('q-ip', ctx.ipHash, 30, 3600);
  const email = clean(b.email, 254).toLowerCase();
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  const u = await jget('user:' + email);
  let ids;
  if (u) ids = u.qs.map((q) => q.id);
  else {
    // same shape for unknown emails, so this cannot be used to find out who has an account
    const h = crypto.createHash('sha256').update(email).update(secretKey()).digest();
    const a = h[0] % QUESTIONS.length;
    const c = (a + 1 + (h[1] % (QUESTIONS.length - 1))) % QUESTIONS.length;
    ids = [QUESTIONS[a].id, QUESTIONS[c].id];
    if (h[2] % 2) ids.push(QUESTIONS[(c + 3) % QUESTIONS.length].id);
    ids = [...new Set(ids)];
  }
  return { questions: ids.map((id) => ({ id, text: QTEXT[id] })) };
});

route('POST', 'auth/reset', async (req, res, b, ctx) => {
  await limit('reset-ip', ctx.ipHash, 20, 3600);
  const email = clean(b.email, 254).toLowerCase();
  const password = String(b.password || '');
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 128) fail(400, 'Choose a new password of 8 to 128 characters.');
  const fk = 'rf:' + sha(email);
  if ((await failCount(fk)) >= 5) fail(429, 'Too many wrong answers. Please try again in an hour.');
  const GENERIC = 'Those answers do not match. Check the spelling and try again.';
  const u = await jget('user:' + email);
  const answers = Array.isArray(b.answers) ? b.answers : [];
  if (!u || answers.length !== u.qs.length) {
    await failBump(fk, 3600);
    fail(400, GENERIC);
  }
  const checks = await Promise.all(u.qs.map((q, i) => checkSecret(normAnswer(answers[i]), q)));
  if (!checks.every(Boolean)) {
    await failBump(fk, 3600);
    fail(400, GENERIC);
  }
  u.pass = await hashSecret(password);
  u.sv += 1; // signs out every other device
  await jset('user:' + email, u);
  await R('DEL', fk);
  login(res, u);
  return { user: publicUser(u) };
});

route('POST', 'auth/password', async (req, res, b) => {
  const u = await needUser(req);
  const next = String(b.newPassword || '');
  if (next.length < 8 || next.length > 128) fail(400, 'Choose a new password of 8 to 128 characters.');
  await limit('pw', sha(u.email), 10, 3600);
  if (!(await checkSecret(String(b.oldPassword || ''), u.pass))) fail(400, 'Your current password is not right.');
  u.pass = await hashSecret(next);
  u.sv += 1;
  await jset('user:' + u.email, u);
  login(res, u);
  return { ok: true };
});
route('POST', 'auth/profile', async (req, res, b) => {
  const u = await needUser(req);
  const name = clean(b.name, 40);
  if (name.length < 2) fail(400, 'Enter a display name (at least 2 characters).');
  u.name = name;
  await jset('user:' + u.email, u);
  return { user: publicUser(u) };
});
route('POST', 'auth/delete', async (req, res, b) => {
  const u = await needUser(req);
  await limit('del', sha(u.email), 5, 3600);
  if (!(await checkSecret(String(b.password || ''), u.pass))) fail(400, 'Your password is not right.');
  await purgeUser(u.email);
  logout(res);
  return { ok: true };
});

/* ---- store: browsing ---- */
route('GET', 'store/apps', async (req, res, b, ctx) => {
  const q = clean(ctx.url.searchParams.get('q') || '', 80).toLowerCase();
  const cat = clean(ctx.url.searchParams.get('cat') || '', 30);
  const sort = ctx.url.searchParams.get('sort') || 'popular';
  const page = Math.max(1, parseInt(ctx.url.searchParams.get('page'), 10) || 1);
  const limitN = Math.min(60, Math.max(1, parseInt(ctx.url.searchParams.get('limit'), 10) || 24));
  const all = await approvedList();
  let list = all.filter((a) => (!cat || a.category === cat) && (!q || `${a.title} ${a.description} ${a.publisher} ${a.publisherName} ${a.repo} ${a.category}`.toLowerCase().includes(q)));
  const bayes = (a) => (a.rating * a.ratingCount + 3.5 * 3) / (a.ratingCount + 3);
  const sorters = {
    popular: (a, b2) => b2.downloads - a.downloads || bayes(b2) - bayes(a),
    top: (a, b2) => bayes(b2) - bayes(a) || b2.downloads - a.downloads,
    newest: (a, b2) => b2.approvedAt - a.approvedAt,
    name: (a, b2) => a.title.localeCompare(b2.title),
  };
  list.sort(has(sorters, sort) ? sorters[sort] : sorters.popular);
  const counts = {};
  all.forEach((a) => (counts[a.category] = (counts[a.category] || 0) + 1));
  const total = list.length;
  return {
    apps: list.slice((page - 1) * limitN, page * limitN),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limitN)),
    categories: counts,
    totalAll: all.length,
    _cache: true,
  };
});

route('GET', 'store/apps/:id', async (req, res, b, ctx) => {
  const a = await jget('app:' + ctx.params.id);
  if (!a || a.status !== 'approved') fail(404, 'That app is not in the store.');
  const stats = toObj(await R('HGETALL', 'stats:' + a.id));
  const me = await userFrom(req);
  const revs = Object.entries(toObj(await R('HGETALL', 'rev:' + a.id)))
    .map(([email, v]) => {
      try {
        const r = JSON.parse(v);
        return { name: r.n, rating: r.r, comment: r.c, time: r.t, mine: !!me && me.email === email };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((x, y) => y.time - x.time)
    .slice(0, 100);
  const dist = [0, 0, 0, 0, 0];
  revs.forEach((r) => dist[r.rating - 1]++);
  return { app: pubApp(a, stats), reviews: revs, distribution: dist };
});

route('POST', 'store/apps/:id/download', async (req, res, b, ctx) => {
  const id = ctx.params.id;
  const a = await jget('app:' + id);
  if (!a || a.status !== 'approved') fail(404, 'That app is not in the store.');
  // one count per person (network) per app per day, so the number cannot be inflated by refreshing
  const first = (await R('SET', `dl:${id}:${ctx.ipHash}`, '1', 'NX', 'EX', 86400)) === 'OK';
  const downloads = first ? await R('HINCRBY', 'stats:' + id, 'dl', 1) : Number(await R('HGET', 'stats:' + id, 'dl')) || 0;
  if (first) invalidate();
  return { downloads: Number(downloads), counted: first };
});

route('POST', 'store/apps/:id/review', async (req, res, b, ctx) => {
  const u = await needUser(req);
  const id = ctx.params.id;
  const a = await jget('app:' + id);
  if (!a || a.status !== 'approved') fail(404, 'That app is not in the store.');
  const rating = Math.round(Number(b.rating));
  if (!(rating >= 1 && rating <= 5)) fail(400, 'Choose a rating from 1 to 5 stars.');
  const comment = clean(b.comment, 600);
  await limit('rev', sha(u.email), 30, 86400, 'You have posted a lot of reviews today. Please try again tomorrow.');
  await R('HSET', 'rev:' + id, u.email, JSON.stringify({ r: rating, c: comment, n: u.name, t: now() }));
  await recalc(id);
  invalidate();
  return { ok: true };
});
route('DELETE', 'store/apps/:id/review', async (req, res, b, ctx) => {
  const u = await needUser(req);
  await R('HDEL', 'rev:' + ctx.params.id, u.email);
  await recalc(ctx.params.id);
  invalidate();
  return { ok: true };
});

/* ---- store: requests (submissions) ---- */
route('POST', 'store/submit', async (req, res, b) => {
  const u = await needUser(req);
  await limit('submit', sha(u.email), 10, 86400, 'You can send up to 10 requests per day. Please try again tomorrow.');
  const { app, verified } = await createApp(b, u);
  if (await R('EXISTS', 'app:' + app.id)) fail(409, 'This app is already in the store or waiting for approval.');
  const pending = (await R('SMEMBERS', 'usersubs:' + u.email)) || [];
  const mine = (await loadApps(pending)).filter((x) => x.app.status === 'pending');
  if (mine.length >= 10) fail(429, 'You already have 10 requests waiting. Please wait for them to be reviewed.');
  await jset('app:' + app.id, app);
  await pipe([['SADD', 'apps:pending', app.id], ['SADD', 'usersubs:' + u.email, app.id]]);
  return { ok: true, id: app.id, kind: app.kind, verified: app.kind === 'link' ? false : verified };
});
route('GET', 'store/mine', async (req) => {
  const u = await needUser(req);
  const ids = (await R('SMEMBERS', 'usersubs:' + u.email)) || [];
  const rows = (await loadApps(ids)).map((x) => ({ id: x.app.id, title: x.app.title, repo: x.app.owner ? `${x.app.owner}/${x.app.repo}` : hostName(x.app.url), kind: x.app.kind === 'link' ? 'link' : 'repo', status: x.app.status, note: x.app.note || '', submittedAt: x.app.submittedAt }));
  rows.sort((a, b2) => b2.submittedAt - a.submittedAt);
  return { submissions: rows };
});

/* ================================================================= admin */
route('POST', 'admin/login', async (req, res, b, ctx) => {
  const c = cfg();
  if (!c.url || !c.token) fail(503, 'The store database is not connected yet.', { code: 'no_db' });
  if (!c.adminPassword) fail(503, 'The admin password is not set yet. Add ADMIN_PASSWORD in Vercel, then redeploy.', { code: 'no_admin_password' });
  await limit('adm-ip', ctx.ipHash, 10, 900, 'Too many attempts. Please wait 15 minutes.');
  await limit('adm-all', 'all', 40, 3600, 'Too many attempts. Please wait a while.');
  const email = clean(b.email, 254).toLowerCase();
  const same = (x, y) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(x)).digest(), crypto.createHash('sha256').update(String(y)).digest());
  const okEmail = same(email, c.adminEmail);
  const okPass = same(String(b.password || ''), c.adminPassword);
  if (!(okEmail && okPass)) fail(401, 'Wrong email or password.');
  setCookie(res, COOKIE_ADMIN, sign({ role: 'admin', sub: c.adminEmail, exp: now() + ADMIN_TTL * 1000 }), ADMIN_TTL, '/api/admin');
  return { ok: true, email: c.adminEmail };
});
route('POST', 'admin/logout', async (req, res) => (setCookie(res, COOKIE_ADMIN, '', 0, '/api/admin'), { ok: true }));
route('GET', 'admin/me', async (req) => {
  const p = needAdmin(req);
  return { admin: true, email: p.sub };
});
route('GET', 'admin/overview', async (req) => {
  needAdmin(req);
  const [users, pending, approved, rejected, messages, reviewRequests] = await pipe([['SCARD', 'users'], ['SCARD', 'apps:pending'], ['SCARD', 'apps:approved'], ['SCARD', 'apps:rejected'], ['SCARD', 'fb:new'], ['SCARD', 'reviewreq']]);
  const list = await approvedList();
  return {
    users,
    pending,
    approved,
    rejected,
    messages,
    reviewRequests,
    downloads: list.reduce((n, a) => n + a.downloads, 0),
    reviews: list.reduce((n, a) => n + a.ratingCount, 0),
  };
});
route('GET', 'admin/apps', async (req, res, b, ctx) => {
  needAdmin(req);
  const status = ctx.url.searchParams.get('status');
  if (!['pending', 'approved', 'rejected'].includes(status)) fail(400, 'Unknown status.');
  const ids = (await R('SMEMBERS', 'apps:' + status)) || [];
  const rows = (await loadApps(ids)).map((x) => ({ ...x.app, downloads: Number(x.stats.dl) || 0, rating: Number(x.stats.rcnt) ? round1(Number(x.stats.rsum) / Number(x.stats.rcnt)) : 0, ratingCount: Number(x.stats.rcnt) || 0 }));
  rows.sort((a, b2) => (b2.submittedAt || 0) - (a.submittedAt || 0));
  return { apps: rows };
});

async function moveApp(a, status) {
  await pipe([['SREM', 'apps:pending', a.id], ['SREM', 'apps:approved', a.id], ['SREM', 'apps:rejected', a.id], ['SADD', 'apps:' + status, a.id]]);
  a.status = status;
  await jset('app:' + a.id, a);
  invalidate();
}
async function needApp(id) {
  const a = await jget('app:' + id);
  if (!a) fail(404, 'App not found.');
  return a;
}
/** Keeps track of how many apps in a row a person got approved (used for reviewer accounts). */
async function countDecision(a, approved) {
  if (!a.submittedBy || a.submittedBy === cfg().adminEmail) return;
  const u = await jget('user:' + a.submittedBy);
  if (!u) return;
  if (approved) {
    if (a.counted) return;
    a.counted = true;
    u.streak = (u.streak || 0) + 1;
  } else {
    if (a.status === 'rejected') return;
    u.streak = 0;
  }
  await jset('user:' + u.email, u);
}
async function decide(a, kind, b, actor) {
  if (kind === 'approve') {
    Object.assign(a, validateListing(b, { partial: true }));
    if (!a.title) a.title = a.repo || (a.url ? hostName(a.url) : 'App');
    a.approvedAt = a.approvedAt || now();
    a.note = '';
    await countDecision(a, true);
    await R('HSETNX', 'stats:' + a.id, 'dl', 0);
  } else {
    a.note = clean(b.note, 300);
    await countDecision(a, false);
  }
  a.decidedBy = actor.id;
  a.decidedByName = actor.name;
  await moveApp(a, kind === 'approve' ? 'approved' : 'rejected');
}
const ADMIN_ACTOR = () => ({ id: 'admin', name: 'Admin' });
route('POST', 'admin/apps/:id/approve', async (req, res, b, ctx) => {
  needAdmin(req);
  const a = await needApp(ctx.params.id);
  if (b.featured !== undefined) a.featured = !!b.featured;
  await decide(a, 'approve', b, ADMIN_ACTOR());
  return { ok: true };
});
route('POST', 'admin/apps/:id/reject', async (req, res, b, ctx) => {
  needAdmin(req);
  await decide(await needApp(ctx.params.id), 'reject', b, ADMIN_ACTOR());
  return { ok: true };
});
route('POST', 'admin/apps/:id/unpublish', async (req, res, b, ctx) => {
  needAdmin(req);
  const a = await needApp(ctx.params.id);
  a.decidedBy = 'admin';
  a.decidedByName = 'Admin';
  await moveApp(a, 'pending');
  return { ok: true };
});
route('POST', 'admin/apps/:id/edit', async (req, res, b, ctx) => {
  needAdmin(req);
  const a = await needApp(ctx.params.id);
  Object.assign(a, validateListing(b, { partial: true }));
  if (b.featured !== undefined) a.featured = !!b.featured;
  await jset('app:' + a.id, a);
  invalidate();
  return { ok: true };
});
route('POST', 'admin/apps/:id/verify', async (req, res, b, ctx) => {
  needAdmin(req);
  const a = await needApp(ctx.params.id);
  if (!a.owner) fail(400, 'This is a plain web link, so there is no GitHub repository to check.');
  const info = await verifyRepo({ owner: a.owner, repo: a.repo, ref: a.ref, subdir: a.subdir });
  Object.assign(a, { publisher: info.publisher, publisherName: info.publisherName, publisherUrl: info.publisherUrl, avatar: info.avatar, stars: info.stars, license: info.license, iconUrl: a.kind === 'link' ? a.iconUrl : info.iconUrl || a.iconUrl, verified: info.verified, files: info.files, size: info.size });
  await jset('app:' + a.id, a);
  invalidate();
  return { ok: true, verified: info.verified };
});
async function removeApp(a) {
  const cmds = [['DEL', 'app:' + a.id], ['DEL', 'stats:' + a.id], ['DEL', 'rev:' + a.id], ['SREM', 'apps:pending', a.id], ['SREM', 'apps:approved', a.id], ['SREM', 'apps:rejected', a.id]];
  if (a.submittedBy) cmds.push(['SREM', 'usersubs:' + a.submittedBy, a.id]);
  await pipe(cmds);
  invalidate();
}
route('DELETE', 'admin/apps/:id', async (req, res, b, ctx) => {
  needAdmin(req);
  await removeApp(await needApp(ctx.params.id));
  return { ok: true };
});
route('POST', 'admin/add', async (req, res, b) => {
  needAdmin(req);
  const { app, verified } = await createApp(b, null);
  if (await R('EXISTS', 'app:' + app.id)) fail(409, 'That app already exists.');
  if (b.featured) app.featured = true;
  await jset('app:' + app.id, app);
  await pipe([['SADD', 'apps:approved', app.id], ['HSETNX', 'stats:' + app.id, 'dl', 0]]);
  invalidate();
  return { ok: true, id: app.id, kind: app.kind, verified };
});
route('GET', 'admin/apps/:id/reviews', async (req, res, b, ctx) => {
  needAdmin(req);
  const rows = Object.entries(toObj(await R('HGETALL', 'rev:' + ctx.params.id))).map(([email, v]) => {
    const r = JSON.parse(v);
    return { email, name: r.n, rating: r.r, comment: r.c, time: r.t };
  });
  rows.sort((a, b2) => b2.time - a.time);
  return { reviews: rows };
});
route('DELETE', 'admin/apps/:id/reviews', async (req, res, b, ctx) => {
  needAdmin(req);
  await R('HDEL', 'rev:' + ctx.params.id, clean(ctx.url.searchParams.get('email'), 254).toLowerCase());
  await recalc(ctx.params.id);
  invalidate();
  return { ok: true };
});
route('GET', 'admin/users', async (req) => {
  needAdmin(req);
  const emails = (await R('SMEMBERS', 'users')) || [];
  const rows = emails.length ? (await pipe(emails.map((e) => ['GET', 'user:' + e]))).filter(Boolean).map((v) => JSON.parse(v)) : [];
  const users = rows.map((u) => ({ email: u.email, name: u.name, created: u.created, reviewer: !!u.reviewer, streak: u.streak || 0, requested: !!u.revReq }));
  users.sort((a, b2) => b2.created - a.created);
  return { users };
});
route('DELETE', 'admin/users', async (req, res, b, ctx) => {
  needAdmin(req);
  const email = clean(ctx.url.searchParams.get('email'), 254).toLowerCase();
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  await purgeUser(email);
  return { ok: true };
});


/* ================================================================= reviewer accounts */
const needReviewer = async (req) => {
  const u = await needUser(req);
  if (!u.reviewer) fail(403, 'Reviewer access is needed for this.');
  return u;
};
route('POST', 'reviewer/request', async (req, res, b) => {
  const u = await needUser(req);
  if (u.reviewer) fail(409, 'You are already an app reviewer.');
  if (u.revReq) fail(409, 'Your request is already waiting for the admin.');
  if ((u.streak || 0) < REVIEW_STREAK) fail(400, `You need ${REVIEW_STREAK} approved apps in a row first. You have ${u.streak || 0}.`);
  if (u.revDeniedAt && now() < u.revDeniedAt + 7 * 864e5) fail(429, 'Your last request was not accepted. You can ask again after a week.');
  u.revReq = { at: now(), message: clean(b.message, 400) };
  await jset('user:' + u.email, u);
  await R('SADD', 'reviewreq', u.email);
  return { user: publicUser(u) };
});

/** Reviewers may judge requests from other people. They cannot touch admin-added apps, decisions made by the admin, or their own requests. */
const reviewerCan = (a, rv) => a.submittedBy !== cfg().adminEmail && a.submittedBy !== rv.email && a.decidedBy !== 'admin';
const reviewRow = (x, rv) => {
  const a = x.app;
  return {
    id: a.id, title: a.title, description: a.description, category: a.category, kind: a.kind === 'link' ? 'link' : 'repo', url: a.kind === 'link' ? a.url : '',
    owner: a.owner, repo: a.repo, subdir: a.subdir || '', publisherName: a.publisherName, iconUrl: a.iconUrl || '', verified: !!a.verified, files: a.files || 0, size: a.size || 0,
    status: a.status, note: a.note || '', submittedAt: a.submittedAt, submittedByName: a.submittedBy === cfg().adminEmail ? 'Admin' : a.submittedByName || '',
    byAdmin: a.submittedBy === cfg().adminEmail, decidedByName: a.decidedByName || '', mine: a.submittedBy === rv.email, can: reviewerCan(a, rv), downloads: Number(x.stats.dl) || 0,
  };
};
route('GET', 'review/apps', async (req, res, b, ctx) => {
  const rv = await needReviewer(req);
  const status = ctx.url.searchParams.get('status');
  if (!['pending', 'approved', 'rejected'].includes(status)) fail(400, 'Unknown status.');
  const ids = (await R('SMEMBERS', 'apps:' + status)) || [];
  const rows = (await loadApps(ids)).map((x) => reviewRow(x, rv));
  rows.sort((a, b2) => (b2.submittedAt || 0) - (a.submittedAt || 0));
  const counts = (await pipe([['SCARD', 'apps:pending'], ['SCARD', 'apps:approved'], ['SCARD', 'apps:rejected']])).map(Number);
  return { apps: rows, counts: { pending: counts[0], approved: counts[1], rejected: counts[2] } };
});
async function reviewTarget(req, id) {
  const rv = await needReviewer(req);
  await limit('review', sha(rv.email), 200, 86400, 'That is a lot of reviews for one day. Please continue tomorrow.');
  const a = await needApp(id);
  if (!reviewerCan(a, rv)) fail(403, a.submittedBy === rv.email ? 'You cannot review your own request.' : 'Apps and decisions from the admin can only be changed by the admin.');
  return { rv, a };
}
route('POST', 'review/apps/:id/approve', async (req, res, b, ctx) => {
  const { rv, a } = await reviewTarget(req, ctx.params.id);
  await decide(a, 'approve', b, { id: rv.email, name: rv.name });
  return { ok: true };
});
route('POST', 'review/apps/:id/reject', async (req, res, b, ctx) => {
  const { rv, a } = await reviewTarget(req, ctx.params.id);
  await decide(a, 'reject', b, { id: rv.email, name: rv.name });
  return { ok: true };
});
route('POST', 'review/apps/:id/unpublish', async (req, res, b, ctx) => {
  const { rv, a } = await reviewTarget(req, ctx.params.id);
  a.decidedBy = rv.email;
  a.decidedByName = rv.name;
  await moveApp(a, 'pending');
  return { ok: true };
});
route('DELETE', 'review/apps/:id', async (req, res, b, ctx) => {
  const { a } = await reviewTarget(req, ctx.params.id);
  await removeApp(a);
  return { ok: true };
});

/* ---- admin: reviewer requests and roles ---- */
route('GET', 'admin/reviewers', async (req) => {
  needAdmin(req);
  const [reqs, revs] = await pipe([['SMEMBERS', 'reviewreq'], ['SMEMBERS', 'reviewers']]);
  const load = async (emails) => (emails && emails.length ? (await pipe(emails.map((e) => ['GET', 'user:' + e]))).filter(Boolean).map((v) => JSON.parse(v)) : []);
  const row = (u) => ({ email: u.email, name: u.name, streak: u.streak || 0, message: (u.revReq && u.revReq.message) || '', at: (u.revReq && u.revReq.at) || 0 });
  return { requests: (await load(reqs)).map(row), reviewers: (await load(revs)).map(row) };
});
route('POST', 'admin/reviewers', async (req, res, b) => {
  needAdmin(req);
  const email = clean(b.email, 254).toLowerCase();
  const u = isEmail(email) ? await jget('user:' + email) : null;
  if (!u) fail(404, 'That account was not found.');
  const action = b.action;
  if (action === 'grant') {
    u.reviewer = true;
    delete u.revReq;
    await pipe([['SREM', 'reviewreq', email], ['SADD', 'reviewers', email]]);
  } else if (action === 'deny') {
    delete u.revReq;
    u.revDeniedAt = now();
    await R('SREM', 'reviewreq', email);
  } else if (action === 'revoke') {
    u.reviewer = false;
    await R('SREM', 'reviewers', email);
  } else fail(400, 'Unknown action.');
  await jset('user:' + email, u);
  return { ok: true };
});

/* ================================================================= messages to the admin (feature requests, bug reports) */
const FB_TYPES = ['feature', 'bug', 'other'];
route('POST', 'feedback/send', async (req, res, b) => {
  const u = await needUser(req);
  await limit('fb', sha(u.email), 5, 86400, 'You can send up to 5 messages per day. Please try again tomorrow.');
  const type = FB_TYPES.includes(b.type) ? b.type : 'other';
  const subject = clean(b.subject, 80);
  const message = clean(b.message, 1500);
  if (subject.length < 3) fail(400, 'Add a short title (at least 3 characters).');
  if (message.length < 10) fail(400, 'Please write a little more (at least 10 characters).');
  const id = now().toString(36) + crypto.randomBytes(3).toString('hex');
  await jset('fb:' + id, { id, type, subject, message, email: u.email, name: u.name, version: clean(b.version, 20), at: now(), status: 'new', reply: '', repliedAt: 0 });
  await pipe([['SADD', 'fb:new', id], ['SADD', 'fbuser:' + u.email, id]]);
  return { ok: true, id };
});
route('GET', 'feedback/mine', async (req) => {
  const u = await needUser(req);
  const ids = (await R('SMEMBERS', 'fbuser:' + u.email)) || [];
  const rows = ids.length ? (await pipe(ids.map((i) => ['GET', 'fb:' + i]))).filter(Boolean).map((v) => JSON.parse(v)) : [];
  rows.sort((a, b2) => b2.at - a.at);
  return { messages: rows.slice(0, 30).map((m) => ({ id: m.id, type: m.type, subject: m.subject, message: m.message, at: m.at, status: m.status, reply: m.reply || '', repliedAt: m.repliedAt || 0 })) };
});
route('GET', 'admin/feedback', async (req, res, b, ctx) => {
  needAdmin(req);
  const status = ctx.url.searchParams.get('status') === 'done' ? 'done' : 'new';
  const ids = (await R('SMEMBERS', 'fb:' + status)) || [];
  const rows = ids.length ? (await pipe(ids.map((i) => ['GET', 'fb:' + i]))).filter(Boolean).map((v) => JSON.parse(v)) : [];
  rows.sort((a, b2) => b2.at - a.at);
  return { messages: rows };
});
route('POST', 'admin/feedback/:id', async (req, res, b, ctx) => {
  needAdmin(req);
  const m = await jget('fb:' + ctx.params.id);
  if (!m) fail(404, 'Message not found.');
  if (b.reply !== undefined) {
    m.reply = clean(b.reply, 1000);
    m.repliedAt = m.reply ? now() : 0;
  }
  if (b.status === 'done' || b.status === 'new') m.status = b.status;
  await jset('fb:' + m.id, m);
  await pipe([['SREM', 'fb:new', m.id], ['SREM', 'fb:done', m.id], ['SADD', 'fb:' + m.status, m.id]]);
  return { ok: true };
});
route('DELETE', 'admin/feedback/:id', async (req, res, b, ctx) => {
  needAdmin(req);
  const m = await jget('fb:' + ctx.params.id);
  if (m) await pipe([['DEL', 'fb:' + m.id], ['SREM', 'fb:new', m.id], ['SREM', 'fb:done', m.id], ['SREM', 'fbuser:' + m.email, m.id]]);
  return { ok: true };
});

/* ================================================================= entry point */
function safeDecode(v) {
  try {
    return decodeURIComponent(v);
  } catch (e) {
    return fail(400, 'That address is not valid.');
  }
}
function matchRoute(method, parts) {
  let pathExists = false;
  for (const r of ROUTES) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    const ok = r.parts.every((p, i) => (p[0] === ':' ? ((params[p.slice(1)] = safeDecode(parts[i])), true) : p === parts[i]));
    if (!ok) continue;
    pathExists = true;
    if (r.method === method) return { fn: r.fn, params };
  }
  return { pathExists };
}
function send(res, status, body, cacheControl) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl ? 'public, max-age=0, must-revalidate' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  // Vercel's own cache (not the browser) may keep public lists for a short while
  if (cacheControl) headers['Vercel-CDN-Cache-Control'] = 's-maxage=30, stale-while-revalidate=120';
  if (res._cookies) headers['Set-Cookie'] = res._cookies;
  res.statusCode = status;
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = req.body;
  if (raw == null) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 100 * 1024) fail(413, 'That request is too large.');
      chunks.push(c);
    }
    raw = Buffer.concat(chunks).toString();
  }
  raw = Buffer.isBuffer(raw) ? raw.toString() : String(raw);
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    fail(400, 'That request was not valid JSON.');
  }
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = url.pathname.replace(/^\/api\/?/, '');
    // vercel.json rewrites /api/:path* to /api/index?route=:path*, so the real path may arrive in ?route=
    const viaQuery = url.searchParams.get('route') || (req.query && [].concat(req.query.route || []).join('/')) || '';
    if ((!p || p === 'index' || p === 'index.js' || p.startsWith('[')) && viaQuery) p = viaQuery;
    url.searchParams.delete('route');
    const parts = p.split('/').filter(Boolean);
    const method = (req.method || 'GET').toUpperCase();
    const hit = matchRoute(method === 'HEAD' ? 'GET' : method, parts);
    if (!hit.fn) return send(res, hit.pathExists ? 405 : 404, { error: hit.pathExists ? 'Method not allowed.' : 'Not found.' });

    if (method !== 'GET' && method !== 'HEAD') {
      // CSRF protection: cookies are SameSite=Strict, and writes must also carry a header that other sites cannot send
      if (req.headers['x-webos'] !== '1') fail(403, 'Blocked: missing request header.');
      const origin = req.headers.origin;
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch (e) {}
        if (host !== req.headers.host) fail(403, 'Blocked: request came from another site.');
      }
    }
    const ip = clientIp(req);
    const ctx = { url, params: hit.params, ip, ipHash: crypto.createHash('sha256').update(ip).update(secretKey()).digest('hex').slice(0, 24) };
    const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);
    const out = await hit.fn(req, res, body, ctx);
    const cacheControl = out && out._cache;
    if (out && out._cache) delete out._cache;
    send(res, 200, out || { ok: true }, cacheControl);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
    console.error('API error:', e && e.stack ? e.stack : e);
    send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
};
