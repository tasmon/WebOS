// WebOS — small UI toolkit: element builder, dialogs, toasts, context menus, helpers.
import { icon } from './icons.js';
export { icon };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tiny hyperscript. Strings are always inserted as text (safe for untrusted app names). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v; // trusted markup only (icons)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled', 'selected', 'indeterminate'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
/** <span class="ico"> wrapping a built-in icon. */
export const ico = (name, size = 18, cls = '') => h('span', { class: 'ico ' + cls, html: icon(name, size) });

export function formatBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
export const formatDate = (ts) =>
  ts ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts) : '—';

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function pickFile(accept = '', multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: 'display:none' });
    input.addEventListener('change', () => {
      resolve(multiple ? [...input.files] : input.files[0] || null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(multiple ? [] : null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/* ------------------------------------------------------------------ modals */
export function modal({ title, content, actions, width = 460, dismiss = true, icon: ic }) {
  actions = actions || [{ label: 'OK', value: true, kind: 'primary' }];
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let closed = false;
    const btnEls = [];
    const api = {
      close(v = null) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.add('out');
        setTimeout(() => backdrop.remove(), 150);
        prevFocus?.focus?.();
        resolve(v);
      },
      setBusy(b) {
        btnEls.forEach((x) => (x.disabled = !!b));
        card.classList.toggle('busy', !!b);
      },
      el: null,
    };
    const body = typeof content === 'function' ? content(api) : content;
    actions.forEach((a) => {
      const b = h(
        'button',
        {
          class: 'btn ' + (a.kind || ''),
          type: 'button',
          onclick: async () => {
            if (a.onClick) {
              const r = await a.onClick(api);
              if (r === false) return;
            }
            api.close(a.value ?? null);
          },
        },
        a.label
      );
      btnEls.push(b);
    });
    const card = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog', style: { width: width + 'px' } },
      title && h('div', { class: 'modal-head' }, ic && ico(ic, 20), h('h2', null, title)),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-foot' }, btnEls)
    );
    const backdrop = h('div', { class: 'modal-backdrop', onpointerdown: (e) => dismiss && e.target === backdrop && api.close(null) }, card);
    api.el = card;
    function onKey(e) {
      if (e.key === 'Escape' && dismiss) {
        e.stopPropagation();
        api.close(null);
      } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const p = btnEls.find((b) => b.classList.contains('primary')) || btnEls[btnEls.length - 1];
        if (p && !p.disabled) p.click();
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.getElementById('modal-root').append(backdrop);
    setTimeout(() => {
      const f = card.querySelector('input:not([type=hidden]), select, textarea') || btnEls[btnEls.length - 1];
      f?.focus();
    }, 30);
  });
}
export const alertBox = (title, message, kind = 'primary') =>
  modal({ title, content: h('p', { class: 'modal-text' }, message), actions: [{ label: 'OK', value: true, kind }] });
export const confirmBox = ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) =>
  modal({
    title,
    content: h('p', { class: 'modal-text' }, message),
    actions: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  }).then((v) => !!v);
export function promptBox({ title, label, value = '', placeholder = '', confirmLabel = 'Save', type = 'text' }) {
  const input = h('input', { class: 'input', type, value, placeholder, spellcheck: 'false' });
  return modal({
    title,
    content: h('label', { class: 'field' }, label && h('span', { class: 'field-label' }, label), input),
    actions: [
      { label: 'Cancel', value: null },
      { label: confirmLabel, kind: 'primary', onClick: (api) => api.close(input.value.trim()) },
    ],
  });
}

/* ------------------------------------------------------------------ toasts */
export function toast(message, opts = {}) {
  const root = document.getElementById('toasts');
  const { title, kind = 'info', timeout = 4500, iconSrc, iconName, actions = [] } = opts;
  const gone = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  const el = h(
    'div',
    { class: 'toast ' + kind, role: 'status' },
    iconSrc
      ? h('img', { class: 'toast-img', src: iconSrc, alt: '' })
      : ico(iconName || (kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info'), 20, 'toast-ico'),
    h(
      'div',
      { class: 'toast-text' },
      title && h('strong', null, title),
      h('span', null, message),
      actions.length > 0 &&
        h(
          'div',
          { class: 'toast-actions' },
          actions.map((a) =>
            h('button', { class: 'btn small', onclick: () => { a.onClick?.(); gone(); } }, a.label)
          )
        )
    ),
    h('button', { class: 'toast-x', 'aria-label': 'Dismiss', onclick: gone, html: icon('x', 14) })
  );
  root.append(el);
  while (root.children.length > 5) root.firstChild.remove();
  if (timeout) setTimeout(gone, timeout);
  return { close: gone };
}

/* ------------------------------------------------------------ context menu */
let menuEl = null;
export function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}
export function showMenu(x, y, items) {
  closeMenu();
  const m = h(
    'div',
    { class: 'ctx', role: 'menu' },
    items.map((it) =>
      it.separator
        ? h('div', { class: 'ctx-sep' })
        : h(
            'button',
            {
              class: 'ctx-item' + (it.danger ? ' danger' : ''),
              role: 'menuitem',
              disabled: it.disabled,
              onclick: () => {
                closeMenu();
                it.onClick?.();
              },
            },
            it.icon ? ico(it.icon, 16) : h('span', { class: 'ico' }),
            h('span', null, it.label),
            it.hint && h('kbd', null, it.hint)
          )
    )
  );
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  menuEl = m;
  m.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  return m;
}
document.addEventListener(
  'pointerdown',
  (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  },
  true
);
document.addEventListener('keydown', (e) => {
  if (menuEl && e.key === 'Escape') closeMenu();
});
window.addEventListener('blur', closeMenu);

/* ------------------------------------------------------- form components */
export function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!checked, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'knob' }));
}
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const btns = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: o.value === value ? 'on' : '',
        'aria-checked': o.value === value ? 'true' : 'false',
        title: o.title || o.label,
        onclick: () => {
          btns.forEach((b, i) => {
            const on = options[i].value === o.value;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', on);
          });
          onChange(o.value);
        },
      },
      o.icon && ico(o.icon, 15),
      o.label
    )
  );
  wrap.append(...btns);
  return wrap;
}
export function selectEl(options, value, onChange) {
  const s = h(
    'select',
    { class: 'select', onchange: () => onChange(s.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label))
  );
  return s;
}
export function rangeEl(min, max, step, value, onInput, fmt = (v) => v) {
  const out = h('output', { class: 'range-out' }, fmt(value));
  const r = h('input', { type: 'range', class: 'range', min, max, step, value });
  r.addEventListener('input', () => {
    out.textContent = fmt(+r.value);
    onInput(+r.value);
  });
  return h('div', { class: 'range-wrap' }, r, out);
}
