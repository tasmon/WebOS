// WebOS — the "Install app" dialog (ZIP / folder / GitHub / link) and drag & drop helpers.
import { h, ico, modal, pickFile, toast } from './ui.js';
import * as inst from './installer.js';
import { listApps } from './db.js';
import { forgetIcon } from './tile.js';

/* ------------------------------------------------------- drag & drop utils */
export function hasDraggedFiles(e) {
  return [...(e.dataTransfer?.types || [])].includes('Files');
}

async function walkEntry(entry, out, base = '') {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ path: (base + entry.name).replace(/^\/+/, ''), getBlob: async () => file });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await walkEntry(child, out, base + entry.name + '/');
    }
  }
}

/** Returns { files, name } from a drop event — a ZIP or a dropped folder. */
export async function readDrop(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const dirs = entries.filter((e) => e.isDirectory);
  if (dirs.length) {
    const out = [];
    await walkEntry(dirs[0], out);
    const files = out.filter((f) => !/(^|\/)(\.git|node_modules|__MACOSX)(\/|$)|(^|\/)\.DS_Store$/.test(f.path));
    return { files, name: dirs[0].name, source: 'folder' };
  }
  const zip = [...dt.files].find((f) => /\.zip$/i.test(f.name) || /zip/.test(f.type));
  if (zip) return { files: await inst.readZipFile(zip), name: zip.name.replace(/\.zip$/i, ''), source: 'zip' };
  throw new inst.InstallError('Drop a .zip file or a folder that contains index.html.');
}

/* ------------------------------------------------------------ the dialog */
/**
 * opts.preload = { files, name, source, sourceUrl, subdir }  → jump straight to the review step
 * opts.replaceId = update that app instead of creating a new one
 * opts.tab = 'zip' | 'folder' | 'github' | 'url'
 * Resolves with the installed app record, or null.
 */
export function openInstaller(opts = {}) {
  let info = null;
  let meta = { source: 'zip', sourceUrl: '', name: '' };
  const objectUrls = [];
  let tab = opts.tab || 'zip';
  const box = h('div', { style: 'min-height:260px' });
  let api;

  const finish = (app) => {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    api.close(app);
  };

  function setLoading(text, pct) {
    box.replaceChildren(
      h(
        'div',
        { style: 'display:grid;gap:1rem;padding:3.2rem 0;justify-items:center;text-align:center' },
        ico('package', 34, ''),
        h('div', null, text),
        h('div', { class: 'progress ' + (pct == null ? 'indet' : ''), style: 'width:260px' }, h('i', { style: pct != null ? `width:${Math.round(pct * 100)}%` : '' }))
      )
    );
    return (p) => {
      const bar = box.querySelector('.progress > i');
      if (bar && p != null) {
        box.querySelector('.progress').classList.remove('indet');
        bar.style.width = Math.round(p * 100) + '%';
      }
    };
  }

  async function load(getFiles, m) {
    meta = { source: 'zip', sourceUrl: '', name: '', subdir: '', ...m };
    const bump = setLoading('Reading…');
    try {
      const files = await getFiles(bump);
      bump(null);
      info = await inst.inspect(files, { subdir: meta.subdir, fallbackName: meta.name });
      await review();
    } catch (e) {
      source(e instanceof inst.InstallError ? e.message : 'Something went wrong: ' + (e.message || e));
    }
  }

  /* ----- step 1: choose a source */
  function source(error) {
    const tabs = [
      ['zip', 'ZIP file', 'package'],
      ['folder', 'Folder', 'folder'],
      ['github', 'GitHub', 'github'],
      ['url', 'Web link', 'link'],
    ];
    const body = h('div');
    const draw = () => {
      body.replaceChildren();
      if (tab === 'zip' || tab === 'folder') {
        const isZip = tab === 'zip';
        const dz = h(
          'div',
          { class: 'drop', role: 'button', tabindex: '0' },
          ico(isZip ? 'package' : 'folder', 34),
          h('b', { style: 'color:var(--text)' }, isZip ? 'Drop a ZIP file here' : 'Drop a folder here'),
          h('span', null, 'or click to browse'),
          h('span', { class: 'hint' }, isZip ? 'A static website zipped up — it must contain an index.html.' : 'The folder must contain an index.html (your site or its build folder).')
        );
        const choose = async () => {
          if (isZip) {
            const f = await pickFile('.zip,application/zip,application/x-zip-compressed');
            if (f) load(() => inst.readZipFile(f), { source: 'zip', name: f.name.replace(/\.zip$/i, '') });
          } else {
            const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, style: 'display:none' });
            input.addEventListener('change', () => {
              const fl = [...input.files];
              input.remove();
              if (!fl.length) return;
              const name = (fl[0].webkitRelativePath || '').split('/')[0];
              load(async () => inst.readFolderFiles(fl), { source: 'folder', name });
            });
            document.body.append(input);
            input.click();
          }
        };
        dz.addEventListener('click', choose);
        dz.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose()));
        ['dragenter', 'dragover'].forEach((n) => dz.addEventListener(n, (e) => (e.preventDefault(), dz.classList.add('over'))));
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.remove('over');
          try {
            const r = await readDrop(e.dataTransfer);
            load(async () => r.files, { source: r.source, name: r.name });
          } catch (err) {
            source(err.message);
          }
        });
        body.append(dz);
      } else {
        const gh = tab === 'github';
        const input = h('input', { class: 'input', value: opts.prefill && tab === (opts.tab || tab) ? opts.prefill : '', placeholder: gh ? 'github.com/owner/repo  or  owner/repo' : 'https://example.com/my-app.zip', spellcheck: 'false', autocomplete: 'off' });
        const go = () => {
          const v = input.value.trim();
          if (!v) return input.focus();
          if (gh) {
            const g = inst.parseGitHubUrl(v);
            if (!g) return source('That does not look like a GitHub repository. Try owner/repo.');
            load((bump) => inst.readGitHub(g, bump), { source: 'github', sourceUrl: v, name: g.repo, subdir: '' });
          } else load((bump) => inst.readUrlZip(v, bump), { source: 'url', sourceUrl: v, name: (v.split('/').pop() || '').replace(/\.zip.*$/i, '') });
        };
        input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
        body.append(
          h(
            'div',
            { class: 'field' },
            h('span', { class: 'field-label' }, gh ? 'GitHub repository' : 'Direct link to a ZIP file'),
            h('div', { style: 'display:flex;gap:.5rem' }, input, h('button', { class: 'btn primary', onclick: go }, 'Continue'))
          ),
          h(
            'p',
            { class: 'hint', style: 'margin-top:.8rem;line-height:1.5' },
            gh
              ? 'Public repositories only. The repo (or its dist/build folder) must contain an index.html. You can also paste a link to a folder inside a repo, like …/tree/main/docs.'
              : "The server must allow downloads from other websites (CORS). If it doesn't, download the ZIP and use the ZIP tab instead."
          )
        );
        setTimeout(() => input.focus(), 30);
        if (opts.autoStart && input.value) {
          opts.autoStart = false;
          setTimeout(go, 0);
        }
      }
    };
    box.replaceChildren(
      h(
        'div',
        { class: 'tabs', role: 'tablist' },
        tabs.map(([k, label, ic]) =>
          h(
            'button',
            {
              role: 'tab',
              class: tab === k ? 'on' : '',
              onclick: (e) => {
                tab = k;
                [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget));
                draw();
              },
            },
            ico(ic, 15),
            label
          )
        )
      ),
      body,
      ...(error ? [h('div', { class: 'err-box', role: 'alert' }, error)] : [])
    );
    draw();
  }

  /* ----- step 2: review & name */
  async function review() {
    const apps = await listApps();
    const target = opts.replaceId ? apps.find((a) => a.id === opts.replaceId) : null;
    const same = !target && apps.find((a) => a.name.toLowerCase() === info.meta.name.toLowerCase());
    let mode = target ? 'update' : same ? 'update' : 'new';
    const replaceId = () => (mode === 'update' ? (target || same).id : null);

    const nameInput = h('input', { class: 'input', value: target ? target.name : info.meta.name, maxlength: 60, spellcheck: 'false' });
    let iconUrl = null;
    const tile = h('span', { class: 'tile' });
    const iconBlobFile = info.iconPath && info.files.find((f) => f.path === info.iconPath);
    if (iconBlobFile) {
      const raw = await iconBlobFile.getBlob();
      iconUrl = URL.createObjectURL(new Blob([raw], { type: inst.mimeFor(iconBlobFile.path) }));
      objectUrls.push(iconUrl);
    } else if (info.inlineIcon) iconUrl = info.inlineIcon;
    if (iconUrl) tile.append(h('img', { src: iconUrl, alt: '' }));
    else {
      tile.append(h('span', { class: 'ltr' }, ([...info.meta.name][0] || '?').toUpperCase()));
      tile.style.background = 'linear-gradient(135deg,var(--accent),#7c3aed)';
    }
    const sizeTxt = (await import('./ui.js')).formatBytes(info.size);
    const modeBox = h('div');
    if (same) {
      const mk = (v, label) =>
        h('label', { style: 'display:flex;gap:.5rem;align-items:center;margin-top:.5rem' }, h('input', { type: 'radio', name: 'mode', checked: mode === v, onchange: () => (mode = v) }), label);
      modeBox.append(
        h('div', { class: 'warn-box' }, ico('info', 16), h('div', null, `“${same.name}” is already installed.`, mk('update', 'Update it (keeps its saved data)'), mk('new', 'Install as a separate copy')))
      );
    }
    const status = h('div');
    const installBtn = h('button', { class: 'btn primary' }, ico('download', 16), target ? 'Update' : 'Install');
    const backBtn = h('button', { class: 'btn', onclick: () => (opts.preload ? finish(null) : source()) }, opts.preload ? 'Cancel' : 'Back');

    installBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim() || info.meta.name;
      installBtn.disabled = backBtn.disabled = nameInput.disabled = true;
      const bar = h('div', { class: 'progress', style: 'margin-top:1rem' }, h('i'));
      status.replaceChildren(bar);
      try {
        const app = await inst.install(info, {
          name,
          source: meta.source,
          sourceUrl: meta.sourceUrl,
          replaceId: replaceId(),
          onProgress: (p) => (bar.firstChild.style.width = Math.round(p * 100) + '%'),
        });
        forgetIcon(app.id);
        finish({ app, updated: !!replaceId() });
      } catch (e) {
        installBtn.disabled = backBtn.disabled = nameInput.disabled = false;
        const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
        status.replaceChildren(
          h('div', { class: 'err-box', role: 'alert' }, quota ? 'Not enough browser storage for this app. Free some space in App Manager and try again.' : 'Install failed: ' + (e.message || e))
        );
      }
    });

    box.replaceChildren(
      h(
        'div',
        { class: 'preview' },
        tile,
        h(
          'div',
          { class: 't' },
          h('b', null, info.meta.name),
          h('span', null, [info.meta.version && 'v' + info.meta.version, `${info.fileCount} files`, sizeTxt].filter(Boolean).join(' · ')),
          info.meta.description && h('span', { style: 'margin-top:.25rem' }, info.meta.description.slice(0, 120))
        )
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), nameInput),
      modeBox,
      h('div', { class: 'warn-box' }, ico('shield', 16), h('div', null, 'Only install apps you trust. Installed apps run inside WebOS and can read data from other apps stored in this browser.')),
      status,
      h('div', { style: 'display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.2rem' }, backBtn, installBtn)
    );
    setTimeout(() => nameInput.select(), 30);
  }

  const p = modal({
    title: opts.replaceId ? 'Update app' : 'Install app',
    icon: 'download',
    width: 520,
    actions: [],
    content: (a) => {
      api = a;
      return box;
    },
  });
  if (opts.preload) load(async () => opts.preload.files, opts.preload);
  else source();
  return p;
}

/** Shared "after install" feedback. */
export function announceInstall(result, openApp) {
  if (!result) return;
  const { app, updated } = result;
  toast(`${app.name} was ${updated ? 'updated' : 'installed'}.`, {
    kind: 'success',
    title: updated ? 'App updated' : 'App installed',
    actions: [{ label: 'Open', onClick: () => openApp(app) }],
  });
}
