// WebOS — the Store: browse, install, rate and request apps. Only GitHub apps approved by the admin are listed.
import { h, ico, toast, confirmBox, promptBox } from './ui.js';
import { OS } from './config.js';
import { get, post, del, ApiError } from './store-api.js';

const SAFE_IMG = /^https:\/\/(raw\.githubusercontent\.com|avatars\.githubusercontent\.com|github\.com)\//;
const SAFE_LINK = /^https:\/\/github\.com\//;
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0));
const SORTS = [
  { value: 'popular', label: 'Most downloaded' },
  { value: 'top', label: 'Top rated' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
];
const MAIL = (subject, body = '') => `mailto:${OS.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  const f = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (s < 3600) return f.format(-Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return f.format(-Math.round(s / 3600), 'hour');
  if (s < 86400 * 30) return f.format(-Math.round(s / 86400), 'day');
  if (s < 86400 * 365) return f.format(-Math.round(s / (86400 * 30)), 'month');
  return f.format(-Math.round(s / (86400 * 365)), 'year');
}
function hue(s) {
  let n = 0;
  for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % 360;
}

function stars(rating, size = 14) {
  const row = () => h('span', { class: 'srow' }, [1, 2, 3, 4, 5].map(() => ico('star', size)));
  return h('span', { class: 'stars', title: rating ? `${rating.toFixed(1)} out of 5` : 'No ratings yet' }, row(), h('span', { class: 'sfill', style: { width: Math.max(0, Math.min(100, (rating / 5) * 100)) + '%' } }, row()));
}
function appIcon(a, size = 56) {
  const t = h('span', { class: 'tile', style: { '--tile': size + 'px' } });
  const letter = () => {
    t.replaceChildren(h('span', { class: 'ltr' }, ([...(a.title || '?')][0] || '?').toUpperCase()));
    t.style.background = `linear-gradient(135deg, hsl(${hue(a.title)} 70% 55%), hsl(${(hue(a.title) + 40) % 360} 70% 42%))`;
  };
  if (a.iconUrl && (SAFE_IMG.test(a.iconUrl) || (a.kind === 'link' && /^https:\/\//.test(a.iconUrl)))) {
    const img = h('img', { src: a.iconUrl, alt: '', draggable: 'false', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', letter);
    t.append(img);
  } else letter();
  return t;
}
const publisher = (a) => (SAFE_LINK.test(a.publisherUrl || '') ? h('a', { href: a.publisherUrl, target: '_blank', rel: 'noopener noreferrer' }, a.publisherName) : h('span', null, a.publisherName));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));

export function buildStore(host, startArg) {
  const root = h('div', { class: 'store' });
  const st = { me: undefined, meta: null, q: '', cat: '', sort: 'popular' };
  const stack = [];
  const updaters = new Set();
  let token = 0; // ignores answers that arrive after the person moved on
  let destroyed = false;

  /* ------------------------------------------------------------ plumbing */
  const installed = (a) => host.apps().find((x) => x.storeId === a.id);
  const offApps = host.onAppsChange(() => updaters.forEach((f) => f()));
  const cur = () => stack[stack.length - 1];

  function nav(name, arg) {
    stack.push({ name, arg });
    render();
  }
  function back() {
    if (stack.length > 1) stack.pop();
    render();
  }
  function replace(name, arg) {
    stack[stack.length - 1] = { name, arg };
    render();
  }
  async function loadMe() {
    try {
      st.me = (await get('auth/me')).user;
    } catch {
      st.me = null;
    }
  }
  async function loadMeta() {
    if (st.meta) return st.meta;
    try {
      st.meta = await get('store/meta');
    } catch {
      st.meta = { categories: ['Productivity', 'Utilities', 'Games', 'Education', 'Developer tools', 'Design', 'Media', 'Finance', 'Health', 'Other'], questions: [] };
    }
    return st.meta;
  }
  const busy = (btn, label, fn) =>
    (async (...a) => {
      const old = btn.textContent;
      btn.disabled = true;
      if (label) btn.textContent = label;
      try {
        return await fn(...a);
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  const errBox = () => h('div', { class: 'form-err', role: 'alert', hidden: true });
  const showErr = (box, e) => {
    box.textContent = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
    box.hidden = false;
  };

  function installButton(a, big) {
    const b = h('button', { class: 'btn ' + (big ? 'primary big' : 'small primary') });
    let working = false;
    const sync = () => {
      const have = installed(a);
      b.disabled = working;
      b.className = 'btn ' + (have ? '' : 'primary ') + (big ? 'big' : 'small');
      b.replaceChildren(ico(have ? 'external' : 'download', big ? 18 : 15), working ? 'Installing…' : have ? 'Open' : 'Get');
    };
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const have = installed(a);
      if (have) return host.openApp(have);
      working = true;
      sync();
      try {
        const r = await host.installFromStore(a);
        if (r && r.counted) a.downloads = (a.downloads || 0) + 1;
      } finally {
        working = false;
        sync();
        if (!destroyed) updaters.forEach((f) => f());
      }
    });
    updaters.add(sync);
    sync();
    return b;
  }

  /* -------------------------------------------------------------- shell */
  function header(view) {
    const account = h(
      'button',
      { class: 'btn ghost small st-acct', onclick: () => cur().name !== 'account' && nav('account'), title: st.me ? 'Your account' : 'Sign in' },
      st.me ? h('span', { class: 'avatar sm' }, [...st.me.name][0].toUpperCase()) : ico('user', 16),
      h('span', { class: 'st-acct-t' }, st.me ? st.me.name : 'Sign in')
    );
    const left = stack.length > 1 ? h('button', { class: 'btn ghost small icon', title: 'Back', 'aria-label': 'Back', onclick: back }, ico('chevronl', 18)) : h('span', { class: 'st-logo' }, ico('store', 20));
    const title = h('b', { class: 'st-title' }, { home: 'Store', detail: 'App details', account: 'Account', submit: 'Request an app', feedback: 'Message the admin', review: 'Review requests' }[view.name] || 'Store');
    return h('div', { class: 'st-head' }, left, title, h('span', { class: 'grow' }), view.name === 'home' && st.me && st.me.reviewer && h('button', { class: 'btn small ghost', onclick: () => nav('review'), title: 'Review requests' }, ico('check', 15), h('span', { class: 'lbl' }, 'Review')), view.name === 'home' && h('button', { class: 'btn small st-req', onclick: () => nav('submit') }, ico('plus', 15), h('span', { class: 'lbl' }, 'Request an app')), account);
  }

  async function render() {
    const my = ++token;
    updaters.clear();
    const view = cur();
    const body = h('div', { class: 'st-scroll' });
    root.replaceChildren(header(view), body);
    const views = { home: viewHome, detail: viewDetail, account: viewAccount, submit: viewSubmit, feedback: viewFeedback, review: viewReview };
    try {
      await views[view.name](body, view.arg, () => my === token && !destroyed);
    } catch (e) {
      if (my !== token) return;
      body.replaceChildren(unavailable(e));
    }
  }

  function unavailable(e) {
    const msg = e instanceof ApiError ? e.message : 'Something went wrong.';
    const setup = e instanceof ApiError && (e.code === 'unavailable' || e.code === 'no_db');
    return h(
      'div',
      { class: 'st-empty' },
      h('div', { class: 'st-empty-ico' }, ico(e && e.code === 'offline' ? 'wifioff' : 'store', 34)),
      h('h3', null, setup ? 'The Store is not ready yet' : 'Could not load the Store'),
      h('p', null, setup ? (e.code === 'no_db' ? 'The Store is not available on this site right now. Please try again later.' : msg) : msg),
      h('button', { class: 'btn primary', onclick: () => render() }, ico('refresh', 16), 'Try again')
    );
  }

  /* --------------------------------------------------------------- home */
  async function viewHome(body, _arg, live) {
    const meta = await loadMeta();
    if (st.me === undefined) loadMe().then(() => live() && cur().name === 'home' && root.firstChild.replaceWith(header(cur())));
    const search = h('input', { class: 'input st-search', type: 'search', placeholder: 'Search apps, publishers…', 'aria-label': 'Search the Store', value: st.q, spellcheck: 'false', autocomplete: 'off' });
    const sortSel = h('select', { class: 'select', 'aria-label': 'Sort', onchange: () => ((st.sort = sortSel.value), load(true)) }, SORTS.map((s) => h('option', { value: s.value, selected: s.value === st.sort }, s.label)));
    const chips = h('div', { class: 'st-chips', role: 'tablist' });
    const grid = h('div', { class: 'st-grid' });
    const more = h('div', { class: 'st-more' });
    const info = h('div', { class: 'st-count hint' });
    body.append(h('div', { class: 'st-tools' }, h('div', { class: 'st-searchwrap' }, ico('search', 16), search), sortSel), chips, info, grid, more);

    let page = 1;
    let counts = {};
    let timer;
    const drawChips = () =>
      chips.replaceChildren(
        ...['', ...meta.categories].filter((c) => !c || counts[c]).map((c) => h('button', { class: 'st-chip' + (st.cat === c ? ' on' : ''), onclick: () => ((st.cat = c), drawChips(), load(true)) }, c || 'All'))
      );
    async function load(reset) {
      const my = token;
      if (reset) {
        page = 1;
        grid.replaceChildren(...[1, 2, 3, 4, 5, 6].map(() => h('div', { class: 'st-card skel' })));
        more.replaceChildren();
      }
      let r;
      try {
        r = await get(`store/apps?q=${encodeURIComponent(st.q)}&cat=${encodeURIComponent(st.cat)}&sort=${st.sort}&page=${page}&limit=24`);
      } catch (e) {
        if (my !== token) return;
        body.replaceChildren(unavailable(e));
        return;
      }
      if (my !== token || !live()) return;
      if (reset) grid.replaceChildren();
      counts = r.categories || {};
      if (reset) drawChips();
      r.apps.forEach((a) => grid.append(card(a)));
      info.textContent = r.total ? `${r.total} app${r.total === 1 ? '' : 's'}${st.q ? ` matching “${st.q}”` : ''}` : '';
      more.replaceChildren();
      if (page < r.pages) more.append(h('button', { class: 'btn', onclick: () => (page++, load(false)) }, 'Show more'));
      if (!r.total) grid.replaceChildren(empty(r.totalAll));
    }
    function empty(totalAll) {
      return h(
        'div',
        { class: 'st-empty wide' },
        h('div', { class: 'st-empty-ico' }, ico(totalAll ? 'search' : 'store', 34)),
        h('h3', null, totalAll ? 'No apps found' : 'The Store is just getting started'),
        h('p', null, totalAll ? 'Try a different word or category.' : 'No apps have been approved yet. Know a great static web app on GitHub? Request it.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => nav('submit') }, ico('plus', 16), 'Request an app'), h('a', { class: 'btn', href: MAIL('WebOS Store listing request'), }, ico('mail', 16), 'Email us'))
      );
    }
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => ((st.q = search.value.trim()), load(true)), 280);
    });
    await load(true);
  }

  function card(a) {
    return h(
      'article',
      { class: 'st-card', tabindex: '0', role: 'button', 'aria-label': `${a.title}, by ${a.publisherName}`, onclick: () => nav('detail', a.id), onkeydown: (e) => e.key === 'Enter' && nav('detail', a.id) },
      h('div', { class: 'st-card-top' }, appIcon(a, 52), h('div', { class: 'st-card-id' }, h('b', null, a.title), h('span', { class: 'by' }, 'by ', a.publisherName))),
      h('p', { class: 'st-desc' }, a.description),
      h('div', { class: 'st-meta' }, h('span', { class: 'rate' }, stars(a.rating, 12), h('em', null, a.ratingCount ? a.rating.toFixed(1) : 'New')), h('span', { class: 'dl', title: 'Downloads' }, ico('download', 13), fmtN(a.downloads)), a.featured && h('span', { class: 'chip ok' }, 'Featured')),
      h('div', { class: 'st-card-foot' }, h('span', { class: 'chip' }, a.category), a.kind === 'link' && h('span', { class: 'chip', title: 'Opens a website in its own browser tab' }, 'Web app'), installButton(a))
    );
  }

  /* ------------------------------------------------------------- detail */
  async function viewDetail(body, id, live) {
    body.append(h('div', { class: 'st-card skel', style: 'height:140px' }));
    const [r] = await Promise.all([get('store/apps/' + encodeURIComponent(id)), st.me === undefined ? loadMe() : 0]);
    if (!live()) return;
    const a = r.app;
    const isLink = a.kind === 'link';
    const ghUrl = a.owner ? `https://github.com/${a.owner}/${a.repo}` : '';
    const reviewsBox = h('div', { class: 'st-reviews' });
    const facts = isLink
      ? [[a.category, 'Category'], [fmtN(a.downloads), 'Downloads'], ['Web app', 'Type'], [hostOf(a.url), 'Website']]
      : [[a.category, 'Category'], [fmtN(a.downloads), 'Downloads'], [a.stars ? fmtN(a.stars) : '0', 'GitHub stars'], [a.license || 'Not stated', 'License']];
    body.replaceChildren(
      h(
        'div',
        { class: 'st-detail' },
        h('div', { class: 'st-hero' }, appIcon(a, 84), h('div', { class: 'st-hero-t' }, h('h2', null, a.title), h('div', { class: 'by' }, 'by ', publisher(a)), h('div', { class: 'st-meta' }, stars(a.rating, 15), h('em', null, a.ratingCount ? `${a.rating.toFixed(1)} · ${a.ratingCount} rating${a.ratingCount === 1 ? '' : 's'}` : 'No ratings yet')), h('div', { class: 'row' }, installButton(a, true), ghUrl && h('a', { class: 'btn big', href: ghUrl, target: '_blank', rel: 'noopener noreferrer' }, ico('github', 17), 'Source')))),
        h('div', { class: 'st-facts' }, facts.map(([v, l]) => h('div', null, h('b', null, v), h('span', null, l)))),
        h('h3', null, 'About this app'),
        h('p', { class: 'st-about' }, a.description),
        h('div', { class: 'st-note' }, ico('shield', 16), h('span', null, isLink ? `This adds a shortcut that opens ${hostOf(a.url)} in its own browser tab. The website is run by its own publisher, not by WebOS, and it needs an internet connection.` : 'Apps run inside WebOS on this site and are not fully isolated. Listed apps are reviewed, but only install apps from publishers you trust.')),
        h('h3', null, 'Ratings and comments'),
        reviewsBox
      )
    );
    drawReviews(reviewsBox, r, id, live);
  }

  function drawReviews(box, r, id, live) {
    const total = r.reviews.length;
    const max = Math.max(1, ...r.distribution);
    const summary = h(
      'div',
      { class: 'st-sum' },
      h('div', { class: 'big' }, r.app.ratingCount ? r.app.rating.toFixed(1) : '–', h('small', null, stars(r.app.rating, 14))),
      h('div', { class: 'bars' }, [5, 4, 3, 2, 1].map((n) => h('div', { class: 'bar' }, h('span', null, n), h('i', null, h('u', { style: { width: (r.distribution[n - 1] / max) * 100 + '%' } })), h('span', { class: 'n' }, r.distribution[n - 1]))))
    );
    const mine = r.reviews.find((x) => x.mine);
    let form;
    if (!st.me) {
      form = h('div', { class: 'st-signin' }, h('span', null, 'Sign in to rate this app and leave a comment.'), h('button', { class: 'btn small primary', onclick: () => nav('account', { next: 'back' }) }, 'Sign in'));
    } else {
      let rating = mine ? mine.rating : 0;
      const pick = h('div', { class: 'st-pick', role: 'radiogroup', 'aria-label': 'Your rating' });
      const paint = () =>
        pick.replaceChildren(
          ...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: 'st-star' + (n <= rating ? ' on' : ''), role: 'radio', 'aria-checked': String(n === rating), 'aria-label': `${n} star${n > 1 ? 's' : ''}`, onclick: () => ((rating = n), paint()) }, ico('star', 26)))
        );
      paint();
      const text = h('textarea', { class: 'input textarea', rows: '3', maxlength: '600', placeholder: 'Share what you think (optional)', value: mine ? mine.comment : '' });
      const err = errBox();
      const send = h('button', { class: 'btn primary', type: 'button' }, ico('send', 15), mine ? 'Update review' : 'Post review');
      send.onclick = busy(send, 'Posting…', async () => {
        err.hidden = true;
        if (!rating) return showErr(err, new ApiError('Tap a star to rate the app.'));
        try {
          await post(`store/apps/${encodeURIComponent(id)}/review`, { rating, comment: text.value });
          toast('Thanks for your review!', { kind: 'success' });
          const nr = await get('store/apps/' + encodeURIComponent(id));
          if (live()) drawReviews(box, nr, id, live);
        } catch (e) {
          showErr(err, e);
        }
      });
      form = h('div', { class: 'st-form' }, h('b', null, mine ? 'Your review' : 'Rate this app'), pick, text, err, h('div', { class: 'row' }, send, mine && h('button', { class: 'btn ghost danger', type: 'button', onclick: async () => { try { await del(`store/apps/${encodeURIComponent(id)}/review`); const nr = await get('store/apps/' + encodeURIComponent(id)); if (live()) drawReviews(box, nr, id, live); } catch (e) { showErr(err, e); } } }, 'Delete')));
    }
    const list = total
      ? r.reviews.map((v) => h('div', { class: 'st-rev' }, h('div', { class: 'st-rev-h' }, h('span', { class: 'avatar sm' }, [...v.name][0].toUpperCase()), h('b', null, v.name, v.mine && h('span', { class: 'chip' }, 'You')), stars(v.rating, 12), h('time', null, ago(v.time))), v.comment && h('p', null, v.comment)))
      : [h('p', { class: 'hint' }, 'No reviews yet. Be the first to share your thoughts.')];
    box.replaceChildren(summary, form, h('div', { class: 'st-revlist' }, list));
  }

  /* ------------------------------------------------------------ account */
  async function viewAccount(body, arg, live) {
    await loadMe();
    if (!live()) return;
    const done = () => {
      if (arg && arg.next === 'back' && stack.length > 1) return back();
      if (arg && arg.next === 'submit') return replace('submit');
      if (arg && arg.next === 'feedback') return replace('feedback');
      replace('account');
    };
    if (st.me) return profile(body, live);
    const mode = (arg && arg.mode) || 'login';
    const meta = await loadMeta();
    if (!live()) return;
    const tabs = h('div', { class: 'seg st-tabs' }, [['login', 'Sign in'], ['register', 'Create account']].map(([m, l]) => h('button', { type: 'button', class: m === mode || (mode === 'forgot' && m === 'login') ? 'on' : '', onclick: () => replace('account', { ...arg, mode: m }) }, l)));
    const box = h('div', { class: 'st-auth' }, h('div', { class: 'st-auth-ico' }, ico('user', 28)), tabs);
    body.append(h('div', { class: 'st-center' }, box));
    const welcome = (u) => {
      st.me = u;
      toast(`Signed in as ${u.name}.`, { kind: 'success' });
      done();
    };
    if (mode === 'login') {
      const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true });
      const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
      const err = errBox();
      const go = h('button', { class: 'btn primary wide', type: 'button' }, 'Sign in');
      go.onclick = busy(go, 'Signing in…', async () => {
        err.hidden = true;
        try {
          welcome((await post('auth/login', { email: email.value, password: pw.value })).user);
        } catch (e) {
          showErr(err, e);
        }
      });
      pw.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
      box.append(field('Email', email), field('Password', pw), err, go, h('button', { class: 'linkbtn', type: 'button', onclick: () => replace('account', { ...arg, mode: 'forgot' }) }, 'Forgot your password?'));
    } else if (mode === 'register') {
      const name = h('input', { class: 'input', maxlength: '40', autocomplete: 'nickname', placeholder: 'Shown with your reviews' });
      const email = h('input', { class: 'input', type: 'email', autocomplete: 'email' });
      const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
      const qs = [0, 1, 2].map((i) => ({
        sel: h('select', { class: 'select full' }, meta.questions.map((q, j) => h('option', { value: q.id, selected: j === i }, q.text))),
        ans: h('input', { class: 'input', placeholder: i === 2 ? 'Answer (optional)' : 'Your answer', maxlength: '100', autocomplete: 'off' }),
      }));
      const err = errBox();
      const go = h('button', { class: 'btn primary wide', type: 'button' }, 'Create account');
      go.onclick = busy(go, 'Creating…', async () => {
        err.hidden = true;
        const chosen = qs.filter((q, i) => i < 2 || q.ans.value.trim()).map((q) => ({ id: q.sel.value, answer: q.ans.value }));
        try {
          if (new Set(chosen.map((c) => c.id)).size !== chosen.length) throw new ApiError('Pick a different question for each answer.');
          welcome((await post('auth/register', { name: name.value, email: email.value, password: pw.value, questions: chosen })).user);
        } catch (e) {
          showErr(err, e);
        }
      });
      box.append(
        field('Display name', name),
        field('Email', email, 'Used to sign in. It is never shown to other people.'),
        field('Password', pw, 'At least 8 characters.'),
        h('div', { class: 'st-qs' }, h('b', null, 'Security questions'), h('span', { class: 'hint' }, 'If you forget your password, answering these lets you set a new one. Choose answers only you know, and remember how you typed them.'), qs.map((q) => h('div', { class: 'st-q' }, q.sel, q.ans))),
        err,
        go
      );
    } else {
      forgot(box, arg, welcome);
    }
  }

  function forgot(box, arg, welcome) {
    const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', value: (arg && arg.email) || '' });
    const err = errBox();
    const area = h('div', { class: 'st-qs' });
    const next = h('button', { class: 'btn primary wide', type: 'button' }, 'Continue');
    box.append(h('h3', { class: 'st-h' }, 'Reset your password'), h('p', { class: 'hint' }, 'Enter your email, then answer your security questions.'), field('Email', email), area, err, next, h('button', { class: 'linkbtn', type: 'button', onclick: () => replace('account', { ...arg, mode: 'login' }) }, 'Back to sign in'));
    let questions = null;
    let ansEls = [];
    let pw;
    next.onclick = busy(next, 'Please wait…', async () => {
      err.hidden = true;
      try {
        if (!questions) {
          questions = (await post('auth/questions', { email: email.value })).questions;
          email.readOnly = true;
          ansEls = questions.map(() => h('input', { class: 'input', autocomplete: 'off', maxlength: '100' }));
          pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
          area.replaceChildren(...questions.map((q, i) => field(q.text, ansEls[i])), field('New password', pw, 'At least 8 characters.'));
          next.textContent = 'Set new password';
          return;
        }
        welcome((await post('auth/reset', { email: email.value, answers: ansEls.map((x) => x.value), password: pw.value })).user);
      } catch (e) {
        showErr(err, e);
      }
    });
    // busy() restores the label afterwards, so keep the second-step label in sync
    const base = next.onclick;
    next.onclick = async () => {
      await base();
      if (questions) next.textContent = 'Set new password';
    };
  }

  async function profile(body, live) {
    const me = st.me;
    const name = h('input', { class: 'input', value: me.name, maxlength: '40' });
    const saveName = h('button', { class: 'btn small', type: 'button' }, 'Save');
    const nameErr = errBox();
    saveName.onclick = busy(saveName, 'Saving…', async () => {
      nameErr.hidden = true;
      try {
        st.me = (await post('auth/profile', { name: name.value })).user;
        toast('Name updated.', { kind: 'success' });
        root.firstChild.replaceWith(header(cur()));
      } catch (e) {
        showErr(nameErr, e);
      }
    });
    const oldPw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const newPw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const pwErr = errBox();
    const savePw = h('button', { class: 'btn small', type: 'button' }, 'Change password');
    savePw.onclick = busy(savePw, 'Saving…', async () => {
      pwErr.hidden = true;
      try {
        await post('auth/password', { oldPassword: oldPw.value, newPassword: newPw.value });
        oldPw.value = newPw.value = '';
        toast('Password changed.', { kind: 'success' });
      } catch (e) {
        showErr(pwErr, e);
      }
    });
    const subs = h('div', { class: 'st-subs' }, h('span', { class: 'hint' }, 'Loading…'));
    body.append(
      h(
        'div',
        { class: 'st-center wide' },
        h('div', { class: 'st-auth' }, h('div', { class: 'st-me' }, h('span', { class: 'avatar' }, [...me.name][0].toUpperCase()), h('div', null, h('b', null, me.name), h('div', { class: 'hint' }, me.email))), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => nav('submit') }, ico('plus', 15), 'Request an app'), h('button', { class: 'btn', onclick: async () => { await post('auth/logout').catch(() => {}); st.me = null; toast('Signed out.'); replace('account'); } }, ico('logout', 15), 'Sign out'))),
        h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Your requests'), subs),
        reviewerBox(me, live),
        h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Message the admin'), h('p', { class: 'hint' }, 'Ask for a feature or report a bug. You will see the reply here.'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => nav('feedback') }, ico('message', 15), 'Write a message'))),
        h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Display name'), field('Name', name), nameErr, saveName),
        h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Password'), field('Current password', oldPw), field('New password', newPw), pwErr, savePw),
        h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Delete account'), h('p', { class: 'hint' }, 'Removes your account and your reviews. Apps you installed stay on your desktop.'), h('button', { class: 'btn danger', onclick: deleteAccount }, ico('trash', 15), 'Delete my account'))
      )
    );
    try {
      const r = await get('store/mine');
      if (!live()) return;
      subs.replaceChildren(...(r.submissions.length ? r.submissions.map(subRow) : [h('p', { class: 'hint' }, 'You have not requested any apps yet.')]));
    } catch (e) {
      subs.replaceChildren(h('p', { class: 'hint' }, e.message));
    }
  }
  const STATUS = { pending: ['Waiting for approval', 'warn'], approved: ['In the Store', 'ok'], rejected: ['Not accepted', ''] };
  const subRow = (s) =>
    h('div', { class: 'st-sub' }, h('div', null, h('b', null, s.title), h('div', { class: 'hint' }, s.kind === 'link' ? 'Web app · ' : '', s.repo, s.note ? ` · ${s.note}` : '')), h('span', { class: 'chip ' + STATUS[s.status][1] }, STATUS[s.status][0]));

  async function deleteAccount() {
    if (!(await confirmBox({ title: 'Delete your account?', message: 'Your account and reviews will be removed. This cannot be undone.', confirmLabel: 'Continue', danger: true }))) return;
    const pw = await promptBox({ title: 'Confirm with your password', label: 'Password', type: 'password', confirmLabel: 'Delete account' });
    if (!pw) return;
    try {
      await post('auth/delete', { password: pw });
      st.me = null;
      toast('Your account was deleted.');
      replace('account');
    } catch (e) {
      toast(e.message, { kind: 'error' });
    }
  }

  /* ------------------------------------------------------------- submit */
  async function viewSubmit(body, _a, live) {
    await Promise.all([st.me === undefined ? loadMe() : 0, loadMeta()]);
    if (!live()) return;
    const mailLink = h('a', { class: 'btn', href: MAIL('WebOS Store listing request', 'GitHub link or website:\nApp name:\nWhat it does:\n') }, ico('mail', 15), `Email ${OS.author.split(' ')[0]} instead`);
    if (!st.me) {
      body.append(h('div', { class: 'st-center' }, h('div', { class: 'st-auth' }, h('div', { class: 'st-auth-ico' }, ico('key', 28)), h('h3', { class: 'st-h' }, 'Sign in to send a request'), h('p', { class: 'hint' }, 'A free WebOS account lets us keep track of requests and stops spam. You can also just send an email.'), h('button', { class: 'btn primary wide', onclick: () => replace('account', { next: 'submit', mode: 'register' }) }, 'Create an account'), h('button', { class: 'btn wide', onclick: () => replace('account', { next: 'submit' }) }, 'I already have an account'), mailLink)));
      return;
    }
    let kind = 'repo';
    const intro = h('div', { class: 'st-note' });
    const seg = h('div', { class: 'seg st-tabs' });
    const repo = h('input', { class: 'input', placeholder: 'github.com/owner/repo  or  owner/repo', spellcheck: 'false', autocomplete: 'off' });
    const site = h('input', { class: 'input', placeholder: 'example.com', spellcheck: 'false', autocomplete: 'off', inputmode: 'url', autocapitalize: 'off' });
    const title = h('input', { class: 'input', maxlength: '60' });
    const desc = h('textarea', { class: 'input textarea', rows: '4', maxlength: '500', placeholder: 'What does it do? (at least 20 characters)' });
    const cat = h('select', { class: 'select full' }, st.meta.categories.map((c) => h('option', { value: c }, c)));
    const err = errBox();
    const ok = h('div', { class: 'st-okbox', hidden: true });
    const go = h('button', { class: 'btn primary', type: 'button' }, ico('send', 15), 'Send request');
    const repoField = field('GitHub repository', repo, 'The publisher name shown in the Store comes from the GitHub account that owns it.');
    const siteField = field('Website address', site);
    const draw = () => {
      seg.replaceChildren(...[['repo', 'GitHub app'], ['link', 'Website link']].map(([k, l]) => h('button', { type: 'button', class: k === kind ? 'on' : '', onclick: () => ((kind = k), draw()) }, l)));
      intro.replaceChildren(
        ico('info', 16),
        h('span', null, kind === 'repo' ? 'Public GitHub repositories with an index.html (or a built dist/build folder) are installed into WebOS. If the repository has no index.html because the app runs online (GitHub Pages, Vercel…), add its website address and it is listed as a web app.' : 'Add any website or online app, such as web mail or a chat page. People get a shortcut that opens it in its own browser tab. The website must be public and must not need anything from the person other than signing in to it.')
      );
      repoField.hidden = kind !== 'repo';
      siteField.querySelector('.field-label').textContent = kind === 'repo' ? 'Website address (only if the repository has no index.html)' : 'Website address';
      title.placeholder = kind === 'repo' ? 'Defaults to the repository name' : 'For example: WhatsApp Web';
      err.hidden = true;
    };
    go.onclick = busy(go, 'Checking…', async () => {
      err.hidden = true;
      ok.hidden = true;
      try {
        const r = await post('store/submit', { kind, repo: repo.value, url: site.value, title: title.value, description: desc.value, category: cat.value });
        ok.hidden = false;
        ok.replaceChildren(ico('check', 18), h('span', null, r.kind === 'link' ? 'Request sent as a web app. It will be reviewed before it appears in the Store.' : r.verified ? 'Request sent. The repository checked out and is now waiting for approval.' : 'Request sent. We could not fully check the repository just now, so it will be reviewed by hand.'));
        repo.value = site.value = title.value = desc.value = '';
        loadSubs();
      } catch (e) {
        showErr(err, e);
        if (e instanceof ApiError && e.code === 'needs_url') site.focus();
      }
    });
    const subs = h('div', { class: 'st-subs' });
    async function loadSubs() {
      try {
        const r = await get('store/mine');
        if (live()) subs.replaceChildren(...r.submissions.slice(0, 8).map(subRow));
      } catch {}
    }
    draw();
    body.append(h('div', { class: 'st-center wide' }, intro, h('div', { class: 'st-auth' }, seg, repoField, siteField, field('App name', title), field('Description', desc), field('Category', cat), err, ok, h('div', { class: 'row' }, go, mailLink)), h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Your recent requests'), subs)));
    loadSubs();
  }

  /* ----------------------------------------------- reviewer account box */
  function reviewerBox(me, live) {
    const need = (st.meta && st.meta.reviewStreak) || 5;
    const box = h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'App reviewer'));
    const err = errBox();
    if (me.reviewer) {
      box.append(h('p', { class: 'hint' }, 'You are an app reviewer. You can approve or reject requests from other people. Apps and decisions made by the admin cannot be changed by reviewers.'), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => nav('review') }, ico('check', 15), 'Open review queue')));
      return box;
    }
    const n = Math.min(me.streak || 0, need);
    const bar = h('div', { class: 'st-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(need), 'aria-valuenow': String(n) }, h('i', { style: { width: (n / need) * 100 + '%' } }));
    box.append(h('p', { class: 'hint' }, `Get ${need} of your apps approved in a row and you can ask to become an app reviewer. A rejected request starts the count again.`), bar, h('div', { class: 'hint' }, `${n} of ${need} approved in a row`));
    if (me.reviewerRequested) box.append(h('div', { class: 'st-okbox' }, ico('check', 18), h('span', null, 'Your request is waiting for the admin.')));
    else if (me.reviewerDeniedUntil) box.append(h('p', { class: 'hint' }, `Your last request was not accepted. You can ask again after ${new Date(me.reviewerDeniedUntil).toLocaleDateString()}.`));
    else if (n >= need) {
      const msg = h('textarea', { class: 'input textarea', rows: '2', maxlength: '400', placeholder: 'Why would you like to help? (optional)' });
      const go = h('button', { class: 'btn primary', type: 'button' }, ico('send', 15), 'Request reviewer access');
      go.onclick = busy(go, 'Sending…', async () => {
        err.hidden = true;
        try {
          st.me = (await post('reviewer/request', { message: msg.value })).user;
          toast('Request sent to the admin.', { kind: 'success' });
          if (live()) replace('account');
        } catch (e) {
          showErr(err, e);
        }
      });
      box.append(msg, err, go);
    }
    return box;
  }

  /* ----------------------------------------------------------- feedback */
  async function viewFeedback(body, _a, live) {
    await Promise.all([st.me === undefined ? loadMe() : 0, loadMeta()]);
    if (!live()) return;
    if (!st.me) {
      body.append(h('div', { class: 'st-center' }, h('div', { class: 'st-auth' }, h('div', { class: 'st-auth-ico' }, ico('message', 28)), h('h3', { class: 'st-h' }, 'Sign in to message the admin'), h('p', { class: 'hint' }, 'Registered users can ask for a feature or report a bug. A free account takes a minute.'), h('button', { class: 'btn primary wide', onclick: () => replace('account', { next: 'feedback', mode: 'register' }) }, 'Create an account'), h('button', { class: 'btn wide', onclick: () => replace('account', { next: 'feedback' }) }, 'I already have an account'))));
      return;
    }
    const TYPES = [['feature', 'Feature request'], ['bug', 'Bug report'], ['other', 'Something else']];
    const type = h('select', { class: 'select full' }, TYPES.map(([v, l]) => h('option', { value: v }, l)));
    const subject = h('input', { class: 'input', maxlength: '80', placeholder: 'A short title' });
    const msg = h('textarea', { class: 'input textarea', rows: '6', maxlength: '1500', placeholder: 'Tell us what you would like, or what went wrong and how to see it happen.' });
    const err = errBox();
    const ok = h('div', { class: 'st-okbox', hidden: true });
    const go = h('button', { class: 'btn primary', type: 'button' }, ico('send', 15), 'Send message');
    const list = h('div', { class: 'st-subs' });
    go.onclick = busy(go, 'Sending…', async () => {
      err.hidden = true;
      ok.hidden = true;
      try {
        await post('feedback/send', { type: type.value, subject: subject.value, message: msg.value, version: OS.version });
        ok.hidden = false;
        ok.replaceChildren(ico('check', 18), h('span', null, 'Thank you! Your message was sent to the admin.'));
        subject.value = msg.value = '';
        load();
      } catch (e) {
        showErr(err, e);
      }
    });
    async function load() {
      try {
        const r = await get('feedback/mine');
        if (!live()) return;
        list.replaceChildren(...(r.messages.length ? r.messages.map((m) => h('div', { class: 'fb-msg' }, h('div', { class: 'fb-h' }, h('b', null, m.subject), h('span', { class: 'chip ' + (m.status === 'done' ? 'ok' : '') }, m.status === 'done' ? 'Answered' : 'Sent')), h('div', { class: 'hint' }, `${TYPES.find((t) => t[0] === m.type)?.[1] || 'Message'} · ${ago(m.at)}`), h('p', { class: 'fb-body' }, m.message), m.reply && h('div', { class: 'fb-reply' }, h('b', null, 'Reply from the admin'), h('p', null, m.reply)))) : [h('p', { class: 'hint' }, 'You have not sent any messages yet.')]));
      } catch {}
    }
    body.append(h('div', { class: 'st-center wide' }, h('div', { class: 'st-auth' }, h('p', { class: 'hint' }, 'Your message goes to the person who runs WebOS. Please do not include passwords.'), field('What is it about?', type), field('Title', subject), field('Message', msg), err, ok, go), h('div', { class: 'st-auth' }, h('h3', { class: 'st-h' }, 'Your messages'), list)));
    load();
  }

  /* ------------------------------------------------------------- review */
  async function viewReview(body, _a, live) {
    await Promise.all([st.me === undefined ? loadMe() : 0]);
    if (!live()) return;
    if (!st.me || !st.me.reviewer) {
      body.append(h('div', { class: 'st-empty' }, h('div', { class: 'st-empty-ico' }, ico('shield', 34)), h('h3', null, 'Reviewers only'), h('p', null, 'This page is for approved app reviewers.')));
      return;
    }
    let status = 'pending';
    const tabs = h('div', { class: 'seg st-tabs' });
    const list = h('div', { class: 'st-subs rv-list' });
    body.append(h('div', { class: 'st-center wide' }, h('div', { class: 'st-note' }, ico('info', 16), h('span', null, 'Check that each request does what it says, is safe, and fits the category. Apps added or decided by the admin are read-only for reviewers.')), tabs, list));
    async function load() {
      list.replaceChildren(h('div', { class: 'st-card skel', style: 'height:90px' }));
      let r;
      try {
        r = await get('review/apps?status=' + status);
      } catch (e) {
        if (live()) list.replaceChildren(h('div', { class: 'form-err' }, e.message));
        return;
      }
      if (!live()) return;
      tabs.replaceChildren(...[['pending', 'Waiting'], ['approved', 'Published'], ['rejected', 'Rejected']].map(([k, l]) => h('button', { type: 'button', class: k === status ? 'on' : '', onclick: () => ((status = k), load()) }, l + (r.counts ? ` (${r.counts[k]})` : ''))));
      list.replaceChildren(...(r.apps.length ? r.apps.map(rvCard) : [h('p', { class: 'hint', style: 'text-align:center;padding:1.5rem 0' }, status === 'pending' ? 'Nothing is waiting. Thank you!' : 'Nothing here.')]));
    }
    function rvCard(a) {
      const link = a.kind === 'link' ? a.url : `https://github.com/${a.owner}/${a.repo}${a.subdir ? '/tree/HEAD/' + a.subdir : ''}`;
      const act = (label, cls, fn, confirmText) => {
        const b = h('button', { class: 'btn small ' + cls, type: 'button' }, label);
        b.onclick = async () => {
          if (confirmText && !(await confirmBox({ title: label + '?', message: confirmText, confirmLabel: label, danger: cls.includes('danger') }))) return;
          b.disabled = true;
          try {
            await fn();
            load();
          } catch (e) {
            if (e.message !== 'Cancelled.') toast(e.message, { kind: 'error' });
            b.disabled = false;
          }
        };
        return b;
      };
      const id = encodeURIComponent(a.id);
      const buttons = [];
      if (a.can) {
        if (a.status !== 'approved') buttons.push(act('Approve', 'primary', () => post(`review/apps/${id}/approve`, {})));
        if (a.status === 'pending') buttons.push(act('Reject', 'danger', async () => {
          const note = await promptBox({ title: 'Reject this request', label: 'Reason (shown to the person, optional)', confirmLabel: 'Reject' });
          if (note === null || note === undefined) throw new ApiError('Cancelled.');
          await post(`review/apps/${id}/reject`, { note });
        }));
        if (a.status === 'approved') buttons.push(act('Unpublish', '', () => post(`review/apps/${id}/unpublish`, {}), 'Move this app back to Waiting?'));
        buttons.push(act('Delete', 'ghost danger', () => del(`review/apps/${id}`), `Delete “${a.title}” permanently?`));
      }
      return h(
        'div',
        { class: 'rv-card' },
        h('div', { class: 'st-card-top' }, appIcon({ title: a.title, iconUrl: a.iconUrl, kind: a.kind }, 44), h('div', { class: 'st-card-id' }, h('b', null, a.title), h('span', { class: 'by' }, a.kind === 'link' ? 'Web app · ' + hostOf(a.url) : `${a.owner}/${a.repo}`))),
        h('div', { class: 'rv-chips' }, h('span', { class: 'chip' }, a.category), a.kind === 'link' ? h('span', { class: 'chip' }, 'Web app') : h('span', { class: 'chip ' + (a.verified ? 'ok' : 'warn') }, a.verified ? 'Has index.html' : 'Not verified'), a.byAdmin && h('span', { class: 'chip' }, 'Added by admin'), a.mine && h('span', { class: 'chip' }, 'Your request'), a.decidedByName && a.status !== 'pending' && h('span', { class: 'chip' }, 'Decided by ' + a.decidedByName)),
        h('p', { class: 'st-desc' }, a.description),
        h('div', { class: 'hint' }, `From ${a.submittedByName || 'someone'} · ${ago(a.submittedAt)}`, a.note ? ` · Note: ${a.note}` : ''),
        h('div', { class: 'rv-acts' }, h('a', { class: 'btn small', href: link, target: '_blank', rel: 'noopener noreferrer' }, ico('external', 14), a.kind === 'link' ? 'Open website' : 'Open on GitHub'), ...buttons)
      );
    }
    load();
  }

  /* -------------------------------------------------------------- start */
  stack.push({ name: 'home' });
  if (startArg && ['feedback', 'review', 'account', 'submit'].includes(startArg.view)) stack.push({ name: startArg.view });
  render();

  return {
    el: root,
    go(view, arg) {
      if (['submit', 'feedback', 'review', 'account'].includes(view)) nav(view);
      else if (view === 'detail' && arg) nav('detail', arg);
    },
    destroy() {
      destroyed = true;
      offApps();
    },
  };
}
