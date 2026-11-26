// WebOS — App Manager: list, inspect, update, back up and remove installed apps.
import { h, ico, formatBytes, formatDate, promptBox, confirmBox, download, toast, selectEl } from './ui.js';
import { appTile } from './tile.js';
import { exportAppZip } from './installer.js';

const SRC = { zip: 'ZIP file', folder: 'Folder', github: 'GitHub', url: 'Web link' };

export function buildAppManager(host) {
  let selected = null;
  let query = '';
  let sort = 'name';
  const list = h('div', { class: 'am-list' });
  const detail = h('aside', { class: 'am-detail' });
  const body = h('div', { class: 'am-body' }, list);
  const usage = h('span', null, '');
  const bar = h('div', { class: 'progress' }, h('i'));
  const search = h('input', { class: 'input', placeholder: 'Search apps', 'aria-label': 'Search apps', oninput: (e) => ((query = e.target.value.toLowerCase()), draw()) });

  const top = h(
    'div',
    { class: 'am-top' },
    h('div', { class: 'search' }, ico('search', 16), search),
    selectEl(
      [
        { value: 'name', label: 'Name' },
        { value: 'newest', label: 'Newest' },
        { value: 'size', label: 'Size' },
        { value: 'used', label: 'Last used' },
      ],
      sort,
      (v) => ((sort = v), draw())
    ),
    h('button', { class: 'btn primary', onclick: () => host.install() }, ico('plus', 16), 'Install app')
  );
  const bottom = h('div', { class: 'am-bottom' }, usage, bar);
  const el = h('div', { class: 'am' }, top, body, bottom);

  function sorted(apps) {
    const a = apps.filter((x) => !query || (x.name + ' ' + x.description).toLowerCase().includes(query));
    const by = {
      name: (x, y) => x.name.localeCompare(y.name),
      newest: (x, y) => y.installedAt - x.installedAt,
      size: (x, y) => y.size - x.size,
      used: (x, y) => y.lastOpened - x.lastOpened,
    }[sort];
    return a.sort(by);
  }

  function draw() {
    const apps = host.apps();
    if (selected && !apps.find((a) => a.id === selected)) selected = null;
    list.replaceChildren();
    if (!apps.length) {
      list.append(
        h(
          'div',
          { class: 'am-empty' },
          ico('package', 44),
          h('h2', null, 'No apps installed yet'),
          h('p', null, 'Install a ZIP file, a folder or a GitHub repository to get started.'),
          h('button', { class: 'btn primary', onclick: () => host.install() }, ico('plus', 16), 'Install your first app')
        )
      );
    } else {
      const rows = sorted(apps);
      if (!rows.length) list.append(h('div', { class: 'am-empty' }, h('p', null, 'No apps match your search.')));
      rows.forEach((app) =>
        list.append(
          h(
            'button',
            { class: 'am-item' + (app.id === selected ? ' on' : ''), onclick: () => ((selected = app.id), draw()), ondblclick: () => host.openApp(app) },
            appTile(app),
            h('div', { class: 't' }, h('b', null, app.name), h('span', null, app.description || SRC[app.source] || 'App')),
            h('span', { class: 'sz' }, formatBytes(app.size))
          )
        )
      );
    }
    const app = apps.find((a) => a.id === selected);
    if (app) {
      drawDetail(app);
      if (!detail.isConnected) body.append(detail);
    } else detail.remove();
    updateUsage(apps);
  }

  function drawDetail(app) {
    const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
    detail.replaceChildren(
      h('div', { class: 'big' }, appTile(app)),
      h('h2', null, app.name),
      h('p', { class: 'desc' }, app.description || 'No description.'),
      h(
        'dl',
        { class: 'kv' },
        row('Version', app.version || '—'),
        row('Size', `${formatBytes(app.size)} · ${app.fileCount} files`),
        row('Source', SRC[app.source] || 'ZIP file'),
        row('Installed', formatDate(app.installedAt)),
        app.updatedAt !== app.installedAt && row('Updated', formatDate(app.updatedAt)),
        row('Opened', app.openCount ? `${app.openCount} time${app.openCount === 1 ? '' : 's'}` : 'Never'),
        app.author && row('Author', app.author),
        row('Address', h('code', { style: 'font-size:.72rem' }, '/apps/' + app.id + '/'))
      ),
      h(
        'div',
        { class: 'am-actions' },
        h('button', { class: 'btn primary', onclick: () => host.openApp(app) }, ico('external', 16), 'Open'),
        h('button', { class: 'btn', onclick: () => host.openApp(app, { tab: true }) }, ico('globe', 16), 'Open in new tab'),
        h('button', { class: 'btn', onclick: () => host.togglePin(app) }, ico('pin', 16), app.pinned ? 'Unpin from taskbar' : 'Pin to taskbar'),
        h('button', { class: 'btn', onclick: () => rename(app) }, ico('edit', 16), 'Rename'),
        h('button', { class: 'btn', onclick: () => host.install({ replaceId: app.id, tab: app.source === 'folder' ? 'folder' : app.source || 'zip', prefill: app.sourceUrl }) }, ico('refresh', 16), 'Update…'),
        h('button', { class: 'btn', onclick: () => exportZip(app) }, ico('upload', 16), 'Export as ZIP'),
        h('button', { class: 'btn', onclick: () => clearData(app) }, ico('trash', 16), 'Clear saved data'),
        h('button', { class: 'btn danger', onclick: () => uninstall(app) }, ico('trash', 16), 'Uninstall')
      )
    );
  }

  async function rename(app) {
    const v = await promptBox({ title: 'Rename app', label: 'Name', value: app.name });
    if (v) await host.rename(app, v.slice(0, 60));
  }
  async function exportZip(app) {
    const t = toast('Preparing ZIP…', { timeout: 0, iconName: 'package' });
    try {
      download(await exportAppZip(app), app.id + '.zip');
    } catch (e) {
      toast('Could not export: ' + e.message, { kind: 'error' });
    }
    t.close();
  }
  async function clearData(app) {
    if (await confirmBox({ title: 'Clear saved data?', message: `This deletes everything “${app.name}” has saved in this browser (settings, progress, local databases). The app itself stays installed.`, confirmLabel: 'Clear data', danger: true })) {
      await host.clearData(app.id);
      toast('Saved data cleared.', { kind: 'success' });
    }
  }
  async function uninstall(app) {
    if (await confirmBox({ title: `Uninstall ${app.name}?`, message: 'The app and its saved data will be removed from this browser. You can reinstall it from its ZIP file later.', confirmLabel: 'Uninstall', danger: true })) {
      await host.uninstall(app);
    }
  }

  async function updateUsage(apps) {
    const mine = apps.reduce((s, a) => s + a.size, 0);
    let text = `${apps.length} app${apps.length === 1 ? '' : 's'} · ${formatBytes(mine)}`;
    let pct = 0;
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) {
        text += ` · browser allows about ${formatBytes(est.quota)}`;
        pct = Math.max(mine ? 0.01 : 0, Math.min(1, mine / est.quota));
      }
    } catch {}
    usage.textContent = text;
    bar.firstChild.style.width = pct * 100 + '%';
    bar.style.display = pct ? '' : 'none';
  }

  const off = host.onAppsChange(draw);
  draw();
  return { el, destroy: off, select: (id) => ((selected = id), draw()) };
}
