// WebOS — Settings app.
import { h, ico, switchEl, segmented, selectEl, rangeEl, confirmBox, promptBox, alertBox, toast, pickFile, download, formatBytes } from './ui.js';
import { settings, ACCENTS, WALLPAPERS, setPin, hasPin } from './settings.js';
import { setCustomWallpaper, removeCustomWallpaper, hasCustomWallpaper } from './wallpaper.js';
import { clearSavedSizes } from './wm.js';
import { exportBackup, importBackup, InstallError } from './installer.js';
import { wipeDatabase } from './db.js';
import { OS } from './config.js';
import { canInstall, isStandalone, promptInstall, onInstallChange } from './pwa.js';

const SECTIONS = [
  ['appearance', 'Appearance', 'palette'],
  ['desktop', 'Desktop', 'monitor'],
  ['windows', 'Windows', 'windows'],
  ['taskbar', 'Taskbar & clock', 'layout'],
  ['security', 'Security', 'lock'],
  ['storage', 'Storage & backup', 'drive'],
  ['system', 'System', 'sliders'],
];

const row = (title, desc, ...ctl) =>
  h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('b', null, title), desc && h('span', null, desc)), h('div', { class: 'row-ctl' }, ctl));
const group = (title, ...rows) => [title && h('div', { class: 'group-title' }, title), h('div', { class: 'group' }, rows)];
const toggle = (key, title, desc) => row(title, desc, switchEl(settings.get(key), (v) => settings.set(key, v)));
const seg = (key, options) => segmented(options, settings.get(key), (v) => settings.set(key, v));

export function buildSettings(host, startSection = 'appearance') {
  let section = startSection;
  const main = h('div', { class: 'main' });
  const side = h('nav', { class: 'side', 'aria-label': 'Settings sections' });
  const el = h('div', { class: 'app-pane' }, side, main);
  const cleanups = [];

  function drawSide() {
    side.replaceChildren(
      h('div', { class: 'side-title' }, 'Settings'),
      ...SECTIONS.map(([id, label, ic]) =>
        h('button', { class: 'side-btn' + (id === section ? ' on' : ''), title: label, onclick: () => go(id) }, ico(ic, 18), h('span', null, label))
      )
    );
  }
  function go(id) {
    section = id;
    cleanups.splice(0).forEach((f) => f());
    drawSide();
    main.replaceChildren(...views[id]());
    main.scrollTop = 0;
  }

  /* ------------------------------------------------------------ appearance */
  function appearance() {
    const themeBtn = (v, label) =>
      h('button', { class: `tp ${v}` + (settings.get('theme') === v ? ' on' : ''), onclick: (e) => {
        settings.set('theme', v);
        [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      } }, h('div', { class: 'pv' }, h('i')), h('span', null, label));

    const swatches = h('div', { class: 'swatches' });
    const paintSwatches = () => {
      swatches.replaceChildren(
        ...ACCENTS.map((a) =>
          h('button', { class: 'swatch' + (settings.get('accent').toLowerCase() === a.value ? ' on' : ''), style: { background: a.value }, title: a.name, 'aria-label': a.name, onclick: () => { settings.set('accent', a.value); paintSwatches(); } })
        ),
        h('input', { type: 'color', class: 'swatch-custom', value: settings.get('accent'), title: 'Custom colour', 'aria-label': 'Custom accent colour', oninput: (e) => settings.set('accent', e.target.value), onchange: paintSwatches })
      );
    };
    paintSwatches();

    const walls = h('div', { class: 'walls' });
    const paintWalls = async () => {
      const custom = await hasCustomWallpaper();
      walls.replaceChildren(
        ...Object.entries(WALLPAPERS).map(([id, w]) =>
          h('button', { class: 'wall' + (settings.get('wallpaper') === id ? ' on' : ''), style: { background: w.css }, title: w.name, onclick: () => { settings.set('wallpaper', id); paintWalls(); } }, h('span', null, w.name))
        ),
        ...(custom ? [h('button', { class: 'wall' + (settings.get('wallpaper') === 'custom' ? ' on' : ''), style: { background: '#222' }, onclick: () => { settings.set('wallpaper', 'custom'); paintWalls(); } }, h('span', null, 'Your picture'))] : []),
        h('button', { class: 'wall add', title: 'Upload a picture', onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          try {
            await setCustomWallpaper(f);
            paintWalls();
          } catch {
            toast('That image could not be used.', { kind: 'error' });
          }
        } }, ico('plus', 22))
      );
    };
    paintWalls();

    return [
      h('h1', null, 'Appearance'),
      h('p', { class: 'lead' }, 'Make WebOS look the way you like. Changes apply instantly.'),
      ...group('Theme', h('div', { class: 'row col' }, h('div', { class: 'theme-prev' }, themeBtn('auto', 'Automatic'), themeBtn('light', 'Light'), themeBtn('dark', 'Dark')))),
      ...group('Accent colour', h('div', { class: 'row col' }, swatches)),
      ...group('Wallpaper', h('div', { class: 'row col' }, walls),
        row('Picture fit', 'Only for your own picture.', selectEl([{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }, { value: 'center', label: 'Centre' }, { value: 'tile', label: 'Tile' }], settings.get('wallpaperFit'), (v) => settings.set('wallpaperFit', v))),
        row('Remove your picture', null, h('button', { class: 'btn small', onclick: async () => { await removeCustomWallpaper(); paintWalls(); } }, 'Remove'))
      ),
      ...group('Look & feel',
        toggle('blur', 'Glass blur effects', 'Frosted-glass panels. Turn off on slower devices.'),
        toggle('animations', 'Animations', 'Window and menu transitions.'),
        row('Text size', 'Scales the whole interface.', rangeEl(80, 130, 5, settings.get('fontScale'), (v) => settings.set('fontScale', v), (v) => v + '%')),
        row('Corners', null, seg('radius', [{ value: 'sharp', label: 'Sharp' }, { value: 'normal', label: 'Normal' }, { value: 'round', label: 'Round' }])),
        row('Window buttons', 'Where the close / minimise / maximise buttons go.', seg('windowControls', [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }]))
      ),
    ];
  }

  /* --------------------------------------------------------------- desktop */
  const desktop = () => [
    h('h1', null, 'Desktop'),
    h('p', { class: 'lead' }, 'Choose how your icons look and behave.'),
    ...group('Icons',
      row('Icon size', null, seg('iconSize', [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }])),
      toggle('showLabels', 'Show names under icons'),
      toggle('showSystemIcons', 'Show system icons', 'App Manager, Settings and About on the desktop.'),
      row('Sort apps by', null, selectEl([{ value: 'name', label: 'Name' }, { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }], settings.get('sortApps'), (v) => settings.set('sortApps', v))),
      row('Open icons with', null, seg('openWith', [{ value: 'single', label: 'Single click' }, { value: 'double', label: 'Double click' }]))
    ),
    ...group('Widgets', toggle('desktopClock', 'Big clock on the desktop')),
  ];

  /* --------------------------------------------------------------- windows */
  const windows = () => [
    h('h1', null, 'Windows'),
    h('p', { class: 'lead' }, 'How apps open and behave.'),
    ...group('Opening apps',
      row('Open apps in', 'Choose between a WebOS window or a full browser tab.', seg('appOpenMode', [{ value: 'window', label: 'Window' }, { value: 'tab', label: 'New tab' }])),
      toggle('openMaximized', 'Open windows maximised')
    ),
    ...group('Behaviour',
      toggle('snapAssist', 'Snap assist', 'Drag a window to the screen edge to fill half or all of the screen.'),
      toggle('rememberSizes', 'Remember window sizes'),
      toggle('confirmClose', 'Ask before closing a window'),
      row('Saved window sizes', null, h('button', { class: 'btn small', onclick: () => { clearSavedSizes(); toast('Window sizes reset.', { kind: 'success' }); } }, 'Reset'))
    ),
  ];

  /* --------------------------------------------------------------- taskbar */
  const taskbar = () => [
    h('h1', null, 'Taskbar & clock'),
    h('p', { class: 'lead' }, 'Position and content of the taskbar.'),
    ...group('Taskbar',
      row('Position', null, seg('taskbarPos', [{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }])),
      row('Alignment', null, seg('taskbarAlign', [{ value: 'center', label: 'Centre' }, { value: 'left', label: 'Left' }])),
      toggle('taskbarLabels', 'Show window titles', 'Text next to each icon.'),
      toggle('taskbarAutoHide', 'Auto-hide', 'Slides away until you move the mouse to the screen edge.'),
      row('Pinned apps', 'Pin or unpin from App Manager or by right-clicking an icon.', h('button', { class: 'btn small', onclick: () => host.unpinAll() }, 'Unpin all'))
    ),
    ...group('Clock',
      toggle('clock24', '24-hour time'),
      toggle('clockSeconds', 'Show seconds'),
      toggle('showDate', 'Show the date')
    ),
  ];

  /* -------------------------------------------------------------- security */
  function security() {
    const pinState = h('span', { class: 'chip' + (hasPin() ? ' ok' : '') }, hasPin() ? 'PIN is set' : 'No PIN');
    const redraw = () => go('security');
    const setNew = async () => {
      const a = await promptBox({ title: 'Choose a PIN', label: 'At least 4 digits', type: 'password', confirmLabel: 'Next' });
      if (!a) return;
      if (!/^\d{4,12}$/.test(a)) return alertBox('PIN not set', 'Use 4 to 12 digits only.');
      const b = await promptBox({ title: 'Confirm your PIN', label: 'Enter it again', type: 'password', confirmLabel: 'Set PIN' });
      if (b == null) return;
      if (a !== b) return alertBox('PIN not set', 'The two PINs did not match.');
      await setPin(a);
      toast('PIN set.', { kind: 'success' });
      redraw();
    };
    return [
      h('h1', null, 'Security'),
      h('p', { class: 'lead' }, 'Keep other people on this computer out of your WebOS.'),
      ...group('Lock screen',
        row('PIN', 'Protects the lock screen. It is stored only as a salted hash in this browser.', pinState,
          h('button', { class: 'btn small', onclick: setNew }, hasPin() ? 'Change' : 'Set PIN'),
          hasPin() && h('button', { class: 'btn small danger', onclick: async () => { await setPin(''); settings.set('lockOnStart', false); toast('PIN removed.'); redraw(); } }, 'Remove')),
        row('Lock on start', 'Ask for the PIN every time WebOS opens.', switchEl(settings.get('lockOnStart'), async (v) => {
          if (v && !hasPin()) { await alertBox('Set a PIN first', 'Choose a PIN above to use this option.'); return redraw(); }
          settings.set('lockOnStart', v);
        })),
        row('Lock now', null, h('button', { class: 'btn small', disabled: !hasPin(), onclick: () => host.lock() }, ico('lock', 14), 'Lock'))
      ),
      h('p', { class: 'hint', style: 'margin:-.4rem .3rem 1rem' }, 'The PIN is a convenience lock, not encryption. Anyone with access to this browser profile can still read its stored data.'),
      ...group('Notifications', toggle('notifications', 'Show notifications', 'Pop-ups from WebOS and from apps.')),
    ];
  }

  /* --------------------------------------------------------------- storage */
  function storage() {
    const info = h('div', { class: 'row-text' }, h('b', null, 'Browser storage'), h('span', null, 'Calculating…'));
    const bar = h('div', { class: 'progress', style: 'margin-top:.6rem;width:100%' }, h('i'));
    const persistChip = h('span', { class: 'chip' }, '…');
    (async () => {
      try {
        const est = await navigator.storage.estimate();
        info.querySelector('span').textContent = `${formatBytes(est.usage)} used of about ${formatBytes(est.quota)} available`;
        bar.firstChild.style.width = Math.max(1, (est.usage / est.quota) * 100) + '%';
        const p = await navigator.storage.persisted();
        persistChip.textContent = p ? 'Protected' : 'Not protected';
        persistChip.className = 'chip ' + (p ? 'ok' : 'warn');
      } catch {
        info.querySelector('span').textContent = 'Not available in this browser.';
        persistChip.textContent = 'Unknown';
      }
    })();

    const busy = (msg) => toast(msg, { timeout: 0, iconName: 'package' });
    return [
      h('h1', null, 'Storage & backup'),
      h('p', { class: 'lead' }, 'Apps live inside your browser. Back them up to move them between computers.'),
      ...group('Usage', h('div', { class: 'row col' }, info, bar),
        row('Keep data safe', 'Ask the browser not to delete WebOS data when disk space runs low.', persistChip,
          h('button', { class: 'btn small', onclick: async () => {
            const ok = await navigator.storage?.persist?.();
            toast(ok ? 'Storage is now protected.' : 'The browser declined. Installing WebOS as an app often helps.', { kind: ok ? 'success' : 'info' });
            go('storage');
          } }, 'Protect'))
      ),
      ...group('Backup',
        row('Export everything', 'One .webos file with all apps and settings.', h('button', { class: 'btn small', onclick: async () => {
          const t = busy('Creating backup…');
          try {
            const blob = await exportBackup(settings.all());
            download(blob, `webos-backup-${new Date().toISOString().slice(0, 10)}.webos`);
            toast('Backup saved.', { kind: 'success' });
          } catch (e) { toast('Backup failed: ' + e.message, { kind: 'error' }); }
          t.close();
        } }, ico('upload', 14), 'Export')),
        row('Import a backup', 'Adds the apps from a .webos file. Settings are restored too.', h('button', { class: 'btn small', onclick: async () => {
          const f = await pickFile('.webos,.zip');
          if (!f) return;
          const t = busy('Restoring…');
          try {
            const r = await importBackup(f);
            if (r.settings) settings.replaceAll({ ...r.settings, firstRun: false });
            await host.reloadApps();
            toast(`Restored ${r.count} app${r.count === 1 ? '' : 's'}.`, { kind: 'success' });
          } catch (e) { toast(e instanceof InstallError ? e.message : 'Restore failed: ' + e.message, { kind: 'error' }); }
          t.close();
        } }, ico('download', 14), 'Import'))
      ),
      ...group('Clean up',
        row('Clear all app data', 'Deletes what apps saved (scores, notes, logins). Apps stay installed.', h('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmBox({ title: 'Clear all app data?', message: 'Every app will forget its saved data. This cannot be undone.', confirmLabel: 'Clear', danger: true })) {
            for (const a of host.apps()) await host.clearData(a.id);
            toast('App data cleared.', { kind: 'success' });
          }
        } }, 'Clear')),
        row('Uninstall all apps', null, h('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmBox({ title: 'Uninstall every app?', message: 'All installed apps and their data will be removed.', confirmLabel: 'Uninstall all', danger: true })) {
            for (const a of [...host.apps()]) await host.uninstall(a, true);
            toast('All apps removed.', { kind: 'success' });
          }
        } }, 'Uninstall all'))
      ),
    ];
  }

  /* ---------------------------------------------------------------- system */
  function system() {
    const installBtn = h('button', { class: 'btn small primary', onclick: () => promptInstall() }, ico('download', 14), 'Install');
    const status = h('span', { class: 'chip' });
    const sync = () => {
      installBtn.hidden = !canInstall();
      status.textContent = isStandalone() ? 'Installed' : canInstall() ? 'Available' : 'Use your browser menu';
      status.className = 'chip ' + (isStandalone() ? 'ok' : '');
    };
    sync();
    cleanups.push(onInstallChange(sync));
    return [
      h('h1', null, 'System'),
      h('p', { class: 'lead' }, `${OS.name} ${OS.version}`),
      ...group('WebOS app',
        row('Install WebOS on this device', 'Opens in its own window, launches from your desktop or home screen, and works offline.', status, installBtn),
        row('Check for updates', 'WebOS updates itself when you are online. Force a refresh here.', h('button', { class: 'btn small', onclick: async () => {
          try {
            const reg = await navigator.serviceWorker.getRegistration();
            await reg?.update();
          } catch {}
          toast('Reloading to apply the latest version…');
          setTimeout(() => location.reload(), 700);
        } }, ico('refresh', 14), 'Check'))
      ),
      ...group('Startup',
        toggle('bootAnimation', 'Startup animation'),
        row('Welcome tour', null, h('button', { class: 'btn small', onclick: () => host.welcome() }, 'Show again'))
      ),
      ...group('Reset',
        row('Reset settings', 'Restores the default look and behaviour. Apps are kept.', h('button', { class: 'btn small', onclick: async () => {
          if (await confirmBox({ title: 'Reset all settings?', message: 'Your apps stay installed.', confirmLabel: 'Reset' })) { settings.reset(); go('system'); toast('Settings reset.', { kind: 'success' }); }
        } }, 'Reset')),
        row('Factory reset', 'Removes every app, setting and saved file, then restarts WebOS.', h('button', { class: 'btn small danger', onclick: async () => {
          if (!(await confirmBox({ title: 'Erase everything?', message: 'All apps, their data and all settings will be permanently deleted from this browser.', confirmLabel: 'Erase everything', danger: true }))) return;
          await host.factoryReset();
        } }, 'Erase'))
      ),
      ...group('About', row(OS.name, `By ${OS.author}`, h('button', { class: 'btn small', onclick: () => host.openSystem('about') }, 'About WebOS')))
    ];
  }

  const views = { appearance, desktop, windows, taskbar, security, storage, system };
  drawSide();
  main.replaceChildren(...views[section]());
  return { el, destroy: () => cleanups.splice(0).forEach((f) => f()), go };
}
