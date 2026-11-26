// WebOS — Help: a user guide inside the OS.
import { h, ico } from './ui.js';
import { OS } from './config.js';

const kbd = (...k) => h('span', null, k.map((x, i) => [i ? ' + ' : '', h('kbd', null, x)]));
const code = (t) => h('code', null, t);

function section(icon, title, body, open = false) {
  return h('details', { class: 'help-sec', open }, h('summary', null, ico(icon, 18), h('span', null, title), ico('chevrond', 16, 'chev')), h('div', { class: 'help-body' }, body));
}
const steps = (...items) => h('ol', null, items.map((i) => h('li', null, i)));
const list = (...items) => h('ul', null, items.map((i) => h('li', null, i)));

export function buildHelp(host) {
  const install = h('button', { class: 'btn primary', onclick: () => host.install() }, ico('plus', 16), 'Install an app');

  const sections = [
    section(
      'zap',
      'Quick start',
      [
        steps(
          'Get a ZIP of a website. Any static site works, for example GitHub’s green Code button → Download ZIP.',
          ['Drag the ZIP onto the desktop, or choose ', h('b', null, 'Install app'), '.'],
          'Check the name and icon, then press Install.',
          'Double-click the new icon on the desktop. The app opens in a window.'
        ),
        h('p', null, install),
      ],
      true
    ),
    section('package', 'Ways to install an app', [
      list(
        [h('b', null, 'ZIP file: '), 'drop it on the desktop or pick it with the file chooser.'],
        [h('b', null, 'Folder: '), 'choose a folder that has an index.html in it.'],
        [h('b', null, 'GitHub: '), 'paste ', code('owner/repo'), ' or a full github.com link. The repository must be public.'],
        [h('b', null, 'Web address: '), 'a direct link to a ZIP file. Some sites block this; if so, download the ZIP and drop it instead.']
      ),
      h('p', null, 'Sharing: a link like ', code(`https://${OS.domain}/#install=github:owner/repo`), ' opens WebOS and starts installing that repository.'),
    ]),
    section('check', 'Which ZIP files work?', [
      list(
        'Any ZIP with an index.html. It may sit inside a folder, like GitHub’s downloads.',
        'Plain HTML, CSS and JavaScript sites.',
        ['React, Vue, Svelte or Vite projects: install the ', h('b', null, 'built'), ' folder (usually ', code('dist'), ' or ', code('build'), '), not the source code.'],
        'Apps that need a server or a database of their own (PHP, Node, Python) cannot run here.'
      ),
      h('p', null, 'To control the name, icon and window size, add a ', code('webos.json'), ' file next to index.html. See the project README for the format.'),
    ]),
    section('windows', 'Windows, desktop and taskbar', [
      list(
        'Drag a window by its title bar. Drag its edges or corners to resize.',
        'Drag a window to the left or right edge to fill half the screen, or to the top to maximise it.',
        'Double-click a title bar to maximise or restore.',
        'Right-click an icon for Open, Pin to taskbar, Rename, Export as ZIP and Uninstall.',
        'Right-click the desktop to install an app, change the wallpaper or open Settings.',
        'On a phone every window opens full screen. Use the taskbar to switch.'
      ),
    ]),
    section(
      'keyboard',
      'Keyboard shortcuts',
      h(
        'table',
        { class: 'help-table' },
        [
          [kbd('Alt', 'A'), 'Open the start menu'],
          [kbd('Alt', 'I'), 'Install an app'],
          [kbd('Alt', 'W'), 'Close the active window'],
          [kbd('Alt', 'M'), 'Minimise the active window'],
          [kbd('Alt', 'D'), 'Show the desktop'],
        ].map(([k, d]) => h('tr', null, h('td', null, k), h('td', null, d)))
      )
    ),
    section('sliders', 'Settings', [
      h('p', null, 'Open Settings from the desktop or the start menu. You can change:'),
      list(
        'Appearance: light, dark or automatic theme, accent colour, wallpaper (or your own picture), blur, animations, text size and corner style.',
        'Desktop: icon size, labels, sorting, and single or double click to open.',
        'Windows: open maximised, snapping, remembering sizes, asking before closing, and opening apps in a browser tab.',
        'Taskbar: position, centred or left, auto-hide, clock format.',
        'Security: PIN lock and lock on start.',
        'Storage & backup: see space used, export or import a backup, or erase everything.',
      ),
    ]),
    section('drive', 'Your data and backups', [
      list(
        'Everything is stored inside this browser on this device. Nothing is uploaded anywhere.',
        'Clearing your browser’s site data for this address removes your apps. Make a backup first: Settings → Storage & backup → Export everything.',
        'A backup is a single .webos file. Use “Import a backup” in the same place on any device to get your apps and settings back.',
        'Each app has its own saved data. Uninstalling an app also deletes that data.',
        'To update an app, install the newer ZIP again. WebOS offers to update it and keeps its saved data.'
      ),
    ]),
    section('download', 'Install WebOS on your phone or computer', [
      list(
        ['Android (Chrome): menu ⋮ → ', h('b', null, 'Install app'), ' or ', h('b', null, 'Add to Home screen'), '.'],
        ['iPhone (Safari): Share → ', h('b', null, 'Add to Home Screen'), '.'],
        ['Desktop Chrome or Edge: click the install icon in the address bar, or the download button on the WebOS taskbar.']
      ),
      h('p', null, 'Once installed, WebOS opens like a normal app and works offline.'),
    ]),
    section('alert', 'Troubleshooting', [
      list(
        [h('b', null, 'An app will not open: '), 'WebOS needs service workers. Private or incognito windows and some strict browser settings turn them off. Use a normal window.'],
        [h('b', null, 'The app window is blank: '), 'the ZIP may be source code, not a built site. Install the dist or build folder.'],
        [h('b', null, 'GitHub install fails: '), 'the repository must be public and the name spelled correctly. Otherwise download the ZIP and drop it in.'],
        [h('b', null, 'An app asks me to sign in or cannot reach its server: '), 'WebOS runs static files only. Apps that call their own online services work only while you are online.'],
        [h('b', null, 'Something looks stuck: '), 'choose Restart in the start menu, or reload the page.'],
        [h('b', null, 'Start over: '), 'Settings → Storage & backup → Factory reset removes all apps and settings.']
      ),
    ]),
    section('shield', 'Privacy and safety', [
      list(
        'No accounts, no tracking, no analytics.',
        'Apps run on the same address as WebOS, so they are not fully isolated from each other. Only install apps from people you trust.',
        'The PIN lock keeps casual visitors out. It is not encryption.'
      ),
    ]),
  ];

  return h(
    'div',
    { class: 'help' },
    h('header', null, h('h1', null, 'WebOS Help'), h('p', null, 'Everything you need to install and use web apps.')),
    sections,
    h('footer', null, `WebOS ${OS.version} · ${OS.author} · `, h('a', { href: 'mailto:' + OS.email }, OS.email))
  );
}
