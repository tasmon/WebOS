// WebOS — PDF Reader (uses pdf.js, Apache-2.0). Pages are drawn only when you scroll to them, so big files stay fast.
import { h, ico, toast, pickFile, promptBox } from './ui.js';

let enginePromise = null;
function loadEngine() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => {
      enginePromise = null;
      reject(new Error('The PDF engine files (pdf.min.js and pdf.worker.min.js) are missing from the site.'));
    };
    document.head.append(s);
  });
  return enginePromise;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function buildPdf(host) {
  const root = h('div', { class: 'pdf accepts-files' });
  let doc = null;
  let pages = []; // { n, el, canvas, w, h, state: 'idle'|'busy'|'done', task }
  let zoom = 1;
  let fit = true;
  let base = { w: 612, h: 792 };
  let io = null;
  let destroyed = false;
  let current = 1;
  let ticket = 0;
  let dark = false;

  const open = h('button', { class: 'btn small', type: 'button', onclick: () => pick() }, ico('folder', 15), h('span', { class: 'lbl' }, 'Open'));
  const iconBtn = (icon, title, fn) => h('button', { class: 'btn ghost small icon', type: 'button', title, 'aria-label': title, onclick: fn }, ico(icon, 16));
  const prev = iconBtn('chevronl', 'Previous page', () => goTo(current - 1));
  const next = iconBtn('chevronr', 'Next page', () => goTo(current + 1));
  const pageIn = h('input', { class: 'input pdf-page', type: 'number', min: '1', value: '1', 'aria-label': 'Page number' });
  const pageOf = h('span', { class: 'pdf-of' }, '/ –');
  const zOut = iconBtn('zoomout', 'Zoom out', () => setZoom(zoom / 1.2));
  const zIn = iconBtn('zoomin', 'Zoom in', () => setZoom(zoom * 1.2));
  const zSel = h('select', { class: 'select pdf-zoom', 'aria-label': 'Zoom', onchange: () => (zSel.value === 'fit' ? ((fit = true), applyFit()) : setZoom(+zSel.value)) }, h('option', { value: 'fit' }, 'Fit width'), ZOOMS.map((z) => h('option', { value: z }, Math.round(z * 100) + '%')), h('option', { value: 'custom', hidden: true }, ''));
  const darkBtn = iconBtn('moon', 'Dark pages', () => ((dark = !dark), root.classList.toggle('dark-pages', dark), darkBtn.classList.toggle('on', dark)));
  const bar = h('div', { class: 'pdf-bar' }, open, h('span', { class: 'pdf-sep' }), prev, pageIn, pageOf, next, h('span', { class: 'pdf-sep' }), zOut, zSel, zIn, h('span', { class: 'grow' }), darkBtn);
  const scroller = h('div', { class: 'pdf-scroll' });
  const holder = h('div', { class: 'pdf-pages' });
  const empty = h(
    'div',
    { class: 'md-empty' },
    h('div', { class: 'st-empty-ico' }, ico('pdf', 34)),
    h('h3', null, 'Open a PDF'),
    h('p', null, 'Choose a PDF from your device, drop it here, or open one from a link.'),
    h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: () => pick() }, ico('folder', 16), 'Open PDF'), h('button', { class: 'btn', onclick: () => fromLink() }, ico('link', 16), 'From a link'))
  );
  const status = h('div', { class: 'pdf-status', hidden: true });
  scroller.append(holder, empty);
  root.append(bar, scroller, status);
  enable(false);

  function enable(on) {
    [prev, next, pageIn, zOut, zIn, zSel, darkBtn].forEach((e) => (e.disabled = !on));
  }
  const busy = (msg) => {
    status.hidden = !msg;
    status.textContent = msg || '';
  };

  /* ------------------------------------------------------------- loading */
  async function pick() {
    const f = await pickFile('application/pdf,.pdf');
    if (f) openBytes(await f.arrayBuffer(), f.name);
  }
  async function fromLink() {
    const v = await promptBox({ title: 'Open a PDF from a link', label: 'Address of a PDF file', placeholder: 'https://example.com/file.pdf', confirmLabel: 'Open' });
    if (!v) return;
    busy('Downloading…');
    try {
      const r = await fetch(/^https?:\/\//i.test(v) ? v : 'https://' + v);
      if (!r.ok) throw new Error('The server answered ' + r.status + '.');
      openBytes(await r.arrayBuffer(), v.split('/').pop() || 'document.pdf');
    } catch (e) {
      busy('');
      toast('Could not download that PDF. The site may not allow other pages to read it. Download the file and open it from your device instead.', { kind: 'error', timeout: 8000 });
    }
  }
  async function openBytes(buf, name) {
    const my = ++ticket;
    let lib;
    try {
      lib = await loadEngine();
    } catch (e) {
      return toast(e.message, { kind: 'error', timeout: 8000 });
    }
    busy('Opening ' + name + '…');
    try {
      const task = lib.getDocument({ data: new Uint8Array(buf) });
      task.onPassword = async (cb, reason) => {
        const pw = await promptBox({ title: reason === 2 ? 'Wrong password' : 'This PDF is protected', label: 'Password', type: 'password', confirmLabel: 'Open' });
        if (pw == null) task.destroy();
        else cb(pw);
      };
      const d = await task.promise;
      if (my !== ticket || destroyed) return d.destroy();
      closeDoc();
      doc = d;
      const p1 = await d.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      base = { w: v.width, h: v.height };
      empty.hidden = true;
      enable(true);
      pageIn.max = String(d.numPages);
      pageOf.textContent = '/ ' + d.numPages;
      fit = true;
      current = 1;
      pageIn.value = '1';
      build();
      applyFit();
      scroller.scrollTop = 0;
      host.setTitle?.(name);
    } catch (e) {
      if (e && e.name === 'PasswordException') return busy('');
      toast(e && e.name === 'InvalidPDFException' ? 'That file is not a valid PDF.' : 'Could not open that PDF.', { kind: 'error' });
    }
    busy('');
  }
  function closeDoc() {
    io?.disconnect();
    pages.forEach((p) => p.task?.cancel?.());
    pages = [];
    holder.replaceChildren();
    doc?.destroy();
    doc = null;
  }

  /* ----------------------------------------------------------- rendering */
  function build() {
    io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && render(pages[+e.target.dataset.n - 1])),
      { root: scroller, rootMargin: '700px 0px' }
    );
    for (let n = 1; n <= doc.numPages; n++) {
      const el = h('div', { class: 'pdf-page-box', dataset: { n } });
      const pg = { n, el, canvas: null, state: 'idle', task: null, w: base.w, h: base.h };
      pages.push(pg);
      holder.append(el);
      io.observe(el);
    }
  }
  function size(pg) {
    pg.el.style.width = Math.round(pg.w * zoom) + 'px';
    pg.el.style.height = Math.round(pg.h * zoom) + 'px';
  }
  function layout() {
    pages.forEach((pg) => {
      size(pg);
      if (pg.state !== 'idle') {
        pg.task?.cancel?.();
        pg.canvas?.remove();
        pg.canvas = null;
        pg.state = 'idle';
      }
    });
    io?.disconnect();
    pages.forEach((p) => io.observe(p.el));
  }
  async function render(pg) {
    if (!pg || pg.state !== 'idle' || destroyed || !doc) return;
    pg.state = 'busy';
    const d = doc;
    const z = zoom;
    try {
      const page = await d.getPage(pg.n);
      const vp1 = page.getViewport({ scale: 1 });
      if (Math.abs(vp1.width - pg.w) > 1 || Math.abs(vp1.height - pg.h) > 1) {
        pg.w = vp1.width;
        pg.h = vp1.height;
        size(pg);
      }
      if (d !== doc || z !== zoom) return (pg.state = 'idle');
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      let scale = z * dpr;
      const max = 4096 / Math.max(vp1.width, vp1.height);
      scale = Math.min(scale, max);
      const vp = page.getViewport({ scale });
      const canvas = h('canvas', { class: 'pdf-canvas' });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      pg.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      await pg.task.promise;
      if (d !== doc || z !== zoom) return (pg.state = 'idle');
      pg.canvas = canvas;
      pg.el.replaceChildren(canvas);
      pg.state = 'done';
    } catch (e) {
      pg.state = e && e.name === 'RenderingCancelledException' ? 'idle' : 'done';
    }
  }

  /* ---------------------------------------------------------- navigation */
  function setZoom(z) {
    if (!doc) return;
    fit = false;
    const keep = anchor();
    zoom = Math.max(0.25, Math.min(4, z));
    syncZoom();
    layout();
    restore(keep);
  }
  function applyFit() {
    if (!doc) return;
    const keep = anchor();
    zoom = Math.max(0.25, Math.min(4, (scroller.clientWidth - 24) / base.w));
    syncZoom();
    layout();
    restore(keep);
  }
  function syncZoom() {
    const exact = ZOOMS.find((z) => Math.abs(z - zoom) < 0.005);
    zSel.value = fit ? 'fit' : exact ? String(exact) : 'custom';
    if (!fit && !exact) {
      const c = zSel.querySelector('option[value=custom]');
      c.hidden = false;
      c.textContent = Math.round(zoom * 100) + '%';
    }
  }
  // keep the same spot of the document in view when the zoom changes
  const anchor = () => (pages.length ? { n: current, frac: (scroller.scrollTop - pages[current - 1].el.offsetTop) / Math.max(1, pages[current - 1].el.offsetHeight) } : null);
  const restore = (a) => {
    if (a && pages[a.n - 1]) requestAnimationFrame(() => (scroller.scrollTop = pages[a.n - 1].el.offsetTop + a.frac * pages[a.n - 1].el.offsetHeight));
  };
  function goTo(n) {
    if (!doc) return;
    n = Math.max(1, Math.min(doc.numPages, Math.round(n) || 1));
    scroller.scrollTo({ top: pages[n - 1].el.offsetTop - 8, behavior: 'smooth' });
  }
  let raf = 0;
  scroller.addEventListener('scroll', () => {
    if (raf || !pages.length) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const mid = scroller.scrollTop + scroller.clientHeight / 3;
      let lo = 0;
      let hi = pages.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        pages[m].el.offsetTop <= mid ? (lo = m) : (hi = m - 1);
      }
      current = lo + 1;
      if (document.activeElement !== pageIn) pageIn.value = String(current);
    });
  });
  pageIn.addEventListener('change', () => goTo(+pageIn.value));
  pageIn.addEventListener('keydown', (e) => e.key === 'Enter' && (goTo(+pageIn.value), pageIn.blur()));
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select')) return;
    if (e.key === 'PageDown' || e.key === 'ArrowRight') goTo(current + 1);
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft') goTo(current - 1);
    else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.2);
    else if (e.key === '-') setZoom(zoom / 1.2);
    else if (e.key === 'Home') goTo(1);
    else if (e.key === 'End' && doc) goTo(doc.numPages);
    else return;
    e.preventDefault();
  });
  root.tabIndex = 0;

  // pinch to zoom on touch screens
  const pts = new Map();
  let pinch0 = 0;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) pinch0 = dist();
  });
  scroller.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    if (pts.size === 2 && pinch0) {
      const r = dist() / pinch0;
      if (Math.abs(r - 1) > 0.08) setZoom(zoom * r);
      pinch0 = 0;
    }
    pts.delete(e.pointerId);
  };
  scroller.addEventListener('pointerup', end);
  scroller.addEventListener('pointercancel', end);

  const ro = new ResizeObserver(() => fit && doc && applyFit());
  ro.observe(scroller);

  // drag & drop
  root.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      root.classList.add('drop');
    }
  });
  root.addEventListener('dragleave', () => root.classList.remove('drop'));
  root.addEventListener('drop', async (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove('drop');
    const f = [...e.dataTransfer.files].find((x) => /pdf/i.test(x.type) || /\.pdf$/i.test(x.name));
    if (!f) return toast('Drop a PDF file.', { kind: 'error' });
    openBytes(await f.arrayBuffer(), f.name);
  });

  return {
    el: root,
    destroy() {
      destroyed = true;
      ro.disconnect();
      closeDoc();
    },
  };
}
