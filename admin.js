// WebOS Store admin dashboard (/admin). Sign-in is checked by the server; nothing secret lives in this file.
import { h } from './ui.js';
import { get, post, del, ApiError } from './store-api.js';

const app = document.getElementById('app');
const CATS = ['Productivity', 'Utilities', 'Games', 'Education', 'Developer tools', 'Design', 'Media', 'Finance', 'Health', 'Other'];
const SAFE_IMG = /^https:\/\/(raw\.githubusercontent\.com|avatars\.githubusercontent\.com|github\.com)\//;
const ADMIN_EMAIL = 'tasmon@outlook.com';
const date = (t) => (t ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(t) : '—');
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

function toast(msg, kind = 'info') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}
const errMsg = (e) => (e instanceof ApiError ? e.message : 'Something went wrong.');
async function run(btn, fn) {
  btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return start();
    toast(errMsg(e), 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ----------------------------------------------------------------- login */
async function start() {
  let health = null;
  try {
    health = await get('health');
    const me = await get('admin/me');
    if (me.admin) return dashboard();
  } catch {}
  const email = h('input', { class: 'input', type: 'email', value: ADMIN_EMAIL, autocomplete: 'username' });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Admin password' });
  const err = h('div', { class: 'err', hidden: true });
  const go = h('button', { class: 'btn primary', type: 'button' }, 'Sign in');
  go.onclick = async () => {
    err.hidden = true;
    go.disabled = true;
    try {
      await post('admin/login', { email: email.value, password: pw.value });
      dashboard();
    } catch (e) {
      err.textContent = errMsg(e);
      err.hidden = false;
    }
    go.disabled = false;
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  const warns = [];
  if (!health) warns.push('The API is not reachable. Make sure the file api/[...route].js is in your GitHub repository and the site was redeployed.');
  else {
    if (!health.db) warns.push('The database is not connected. In Vercel: Storage → Create → Upstash Redis → connect it to this project, then redeploy.');
    if (!health.adminPassword) warns.push('The admin password is not set. In Vercel: Settings → Environment Variables → add ADMIN_PASSWORD, then redeploy.');
  }
  app.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'card login' }, h('h1', null, 'WebOS Store admin'), ...warns.map((w) => h('div', { class: 'setup' }, w)), h('label', { class: 'f' }, 'Email', email), h('label', { class: 'f' }, 'Password', pw), err, go, h('a', { href: '/' }, '← Back to WebOS'))));
  pw.focus();
}

/* ------------------------------------------------------------- dashboard */
let tab = 'pending';
async function dashboard() {
  const body = h('div');
  const stats = h('div', { class: 'stats' });
  const tabs = h('div', { class: 'tabs' });
  const out = h('button', { class: 'btn sm' }, 'Sign out');
  out.onclick = async () => {
    await post('admin/logout').catch(() => {});
    start();
  };
  app.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'top' }, h('h1', null, 'WebOS Store admin'), h('a', { class: 'btn sm', href: '/' }, 'Open WebOS'), out), stats, tabs, body));

  let ov = {};
  async function refresh() {
    try {
      ov = await get('admin/overview');
    } catch (e) {
      if (e.status === 401) return start();
    }
    stats.replaceChildren(...[['pending', 'Waiting'], ['approved', 'Published'], ['users', 'Accounts'], ['downloads', 'Downloads'], ['reviews', 'Reviews'], ['rejected', 'Rejected']].map(([k, l]) => h('div', { class: 'stat' }, h('b', null, ov[k] ?? '–'), h('span', null, l))));
    tabs.replaceChildren(...[['pending', 'Waiting'], ['approved', 'Published'], ['rejected', 'Rejected'], ['users', 'Accounts'], ['add', 'Add app']].map(([k, l]) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), onclick: () => ((tab = k), refresh(), show()) }, l, ['pending', 'approved', 'rejected'].includes(k) && ov[k] != null ? h('i', null, ov[k]) : null)));
  }
  async function show() {
    body.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    try {
      if (tab === 'users') return users(body, refresh);
      if (tab === 'add') return addForm(body, refresh, () => ((tab = 'approved'), refresh(), show()));
      const r = await get('admin/apps?status=' + tab);
      body.replaceChildren(h('div', { class: 'list' }, r.apps.length ? r.apps.map((a) => appCard(a, async () => (await refresh(), show()))) : h('div', { class: 'empty' }, tab === 'pending' ? 'Nothing is waiting for approval. 🎉' : 'Nothing here yet.')));
    } catch (e) {
      if (e.status === 401) return start();
      body.replaceChildren(h('div', { class: 'err' }, errMsg(e)));
    }
  }
  await refresh();
  show();
}

function appCard(a, reload) {
  const box = h('div', { class: 'app' });
  const icon = h('div', { class: 'ic' });
  if (a.iconUrl && SAFE_IMG.test(a.iconUrl)) {
    const img = h('img', { src: a.iconUrl, alt: '' });
    img.onerror = () => icon.replaceChildren([...a.title][0].toUpperCase());
    icon.append(img);
  } else icon.append([...a.title][0].toUpperCase());
  const gh = `https://github.com/${a.owner}/${a.repo}`;
  const act = (label, cls, fn, confirmText) => {
    const b = h('button', { class: 'btn sm ' + cls, type: 'button' }, label);
    b.onclick = () => {
      if (confirmText && !confirm(confirmText)) return;
      run(b, async () => {
        await fn();
        await reload();
      });
    };
    return b;
  };
  const extra = h('div');
  const editBtn = h('button', { class: 'btn sm', type: 'button' }, 'Edit');
  editBtn.onclick = () => {
    if (extra.firstChild) return extra.replaceChildren();
    const t = h('input', { class: 'input', value: a.title, maxlength: '60' });
    const d = h('textarea', { rows: '4', maxlength: '500' }, a.description);
    d.value = a.description;
    const c = h('select', null, CATS.map((x) => h('option', { value: x, selected: x === a.category }, x)));
    const f = h('input', { type: 'checkbox', checked: !!a.featured });
    const save = h('button', { class: 'btn primary sm', type: 'button' }, 'Save');
    save.onclick = () => run(save, async () => {
      await post(`admin/apps/${encodeURIComponent(a.id)}/edit`, { title: t.value, description: d.value, category: c.value, featured: f.checked });
      toast('Saved.', 'success');
      await reload();
    });
    extra.replaceChildren(h('div', { class: 'edit' }, h('label', { class: 'f' }, 'Name', t), h('label', { class: 'f' }, 'Description', d), h('label', { class: 'f' }, 'Category', c), h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center' }, f, 'Featured'), save));
  };
  const revBtn = h('button', { class: 'btn sm', type: 'button' }, 'Reviews');
  revBtn.onclick = async () => {
    if (extra.firstChild) return extra.replaceChildren();
    await run(revBtn, async () => {
      const r = await get(`admin/apps/${encodeURIComponent(a.id)}/reviews`);
      extra.replaceChildren(h('div', { class: 'edit' }, r.reviews.length ? r.reviews.map((v) => h('div', { class: 'rev' }, h('div', null, h('b', null, `${'★'.repeat(v.rating)}${'☆'.repeat(5 - v.rating)} ${v.name}`), h('div', { class: 'sub' }, `${v.email} · ${date(v.time)}`), v.comment && h('p', null, v.comment)), (() => { const x = h('button', { class: 'btn sm danger', type: 'button' }, 'Delete'); x.onclick = () => run(x, async () => { await del(`admin/apps/${encodeURIComponent(a.id)}/reviews?email=${encodeURIComponent(v.email)}`); toast('Review deleted.', 'success'); revBtn.click(); revBtn.click(); }); return x; })())) : h('div', { class: 'sub' }, 'No reviews.')));
    });
  };
  const buttons = [];
  if (a.status !== 'approved') buttons.push(act('Approve', 'ok', async () => post(`admin/apps/${encodeURIComponent(a.id)}/approve`, {})));
  if (a.status === 'pending') {
    const rj = h('button', { class: 'btn sm danger', type: 'button' }, 'Reject');
    rj.onclick = () => {
      const note = prompt('Reason (shown to the person who asked, optional):', '');
      if (note === null) return;
      run(rj, async () => {
        await post(`admin/apps/${encodeURIComponent(a.id)}/reject`, { note });
        await reload();
      });
    };
    buttons.push(rj);
  }
  if (a.status === 'approved') buttons.push(act('Unpublish', '', () => post(`admin/apps/${encodeURIComponent(a.id)}/unpublish`, {}), 'Move this app back to Waiting?'));
  buttons.push(h('a', { class: 'btn sm', href: `/#install=github:${a.owner}/${a.repo}`, target: '_blank', rel: 'noopener' }, 'Test install'), h('a', { class: 'btn sm', href: gh, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'), editBtn, act('Re-check', '', async () => { const r = await post(`admin/apps/${encodeURIComponent(a.id)}/verify`, {}); toast(r.verified ? 'Repository checked: OK.' : 'Could not fully check the repository.', r.verified ? 'success' : 'error'); }));
  if (a.status === 'approved') buttons.push(revBtn);
  buttons.push(act('Delete', 'danger', () => del('admin/apps/' + encodeURIComponent(a.id)), `Delete "${a.title}" and all its reviews and download count?`));
  box.append(
    h('div', { class: 'app-h' }, icon, h('div', null, h('b', null, a.title), h('div', { class: 'sub' }, `${a.owner}/${a.repo}${a.subdir ? '/' + a.subdir : ''}`))),
    h('div', { class: 'chips' }, h('span', { class: 'chip' }, a.category), h('span', { class: 'chip ' + (a.verified ? 'ok' : 'warn') }, a.verified ? 'Checked: has index.html' : 'Not verified'), a.featured && h('span', { class: 'chip ok' }, 'Featured'), h('span', { class: 'chip' }, `Publisher: ${a.publisherName} (@${a.publisher})`), a.files ? h('span', { class: 'chip' }, `${a.files} files · ${kb(a.size)}`) : null, a.license ? h('span', { class: 'chip' }, a.license) : null, a.status === 'approved' ? h('span', { class: 'chip' }, `${a.downloads} downloads · ${a.ratingCount ? a.rating + '★ (' + a.ratingCount + ')' : 'no ratings'}`) : null),
    h('p', { class: 'desc' }, a.description),
    h('div', { class: 'sub' }, `Requested by ${a.submittedByName || ''} <${a.submittedBy}> · ${date(a.submittedAt)}`, a.note ? ` · Note: ${a.note}` : ''),
    h('div', { class: 'acts' }, buttons),
    extra
  );
  return box;
}

async function users(body, refresh) {
  const r = await get('admin/users');
  body.replaceChildren(h('div', { class: 'card' }, r.users.length ? r.users.map((u) => { const b = h('button', { class: 'btn sm danger', type: 'button' }, 'Delete'); b.onclick = () => confirm(`Delete ${u.email} and all their reviews?`) && run(b, async () => { await del('admin/users?email=' + encodeURIComponent(u.email)); toast('Account deleted.', 'success'); await refresh(); users(body, refresh); }); return h('div', { class: 'urow' }, h('div', null, h('b', null, u.name), h('div', { class: 'sub' }, `${u.email} · joined ${date(u.created)}`)), b); }) : h('div', { class: 'empty' }, 'No accounts yet.')));
}

function addForm(body, refresh, done) {
  const repo = h('input', { class: 'input', placeholder: 'github.com/owner/repo or owner/repo' });
  const title = h('input', { class: 'input', maxlength: '60', placeholder: 'Optional' });
  const desc = h('textarea', { rows: '4', maxlength: '500', placeholder: 'At least 20 characters' });
  const cat = h('select', null, CATS.map((c) => h('option', { value: c }, c)));
  const feat = h('input', { type: 'checkbox' });
  const go = h('button', { class: 'btn primary', type: 'button' }, 'Publish now');
  go.onclick = () => run(go, async () => {
    const r = await post('admin/add', { repo: repo.value, title: title.value, description: desc.value, category: cat.value, featured: feat.checked });
    toast(r.verified ? 'Published.' : 'Published (could not verify the repository).', 'success');
    await refresh();
    done();
  });
  body.replaceChildren(h('div', { class: 'card edit' }, h('label', { class: 'f' }, 'GitHub repository', repo), h('label', { class: 'f' }, 'Name', title), h('label', { class: 'f' }, 'Description', desc), h('label', { class: 'f' }, 'Category', cat), h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center' }, feat, 'Featured'), go));
}

start();
