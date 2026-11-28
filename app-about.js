// WebOS — About window.
import { h, ico } from './ui.js';
import { logo } from './icons.js';
import { OS } from './config.js';

export function buildAbout(host) {
  const row = (iconName, title, sub) =>
    h('div', { class: 'row' }, h('div', { class: 'row-text', style: 'display:flex;gap:.8rem;align-items:center' }, ico(iconName, 20), h('div', null, h('b', null, title), h('span', null, sub))));
  return h(
    'div',
    { class: 'about' },
    h('div', { class: 'about-logo', role: 'img', 'aria-label': 'WebOS logo', html: logo(96) }),
    h('h1', null, OS.name),
    h('div', { class: 'ver' }, `Version ${OS.version}`),
    h('p', { class: 'tag' }, OS.tagline + ' Install web apps from ZIP files, folders or GitHub, add websites as app shortcuts, and run them in windows — even offline.'),
    h(
      'div',
      { class: 'group about-card' },
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'row-text', style: 'display:flex;gap:.8rem;align-items:center' }, ico('user', 20), h('div', null, h('b', null, 'Developer'), h('span', null, OS.author)))
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          { class: 'row-text', style: 'display:flex;gap:.8rem;align-items:center' },
          ico('mail', 20),
          h('div', null, h('b', null, 'Contact'), h('span', null, h('a', { href: 'mailto:' + OS.email }, OS.email)))
        )
      ),
      row('globe', 'Website', OS.domain),
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'row-text', style: 'display:flex;gap:.8rem;align-items:center' }, ico('message', 20), h('div', null, h('b', null, 'Feature requests and bugs'), h('span', null, 'Registered Store users can message the admin directly.'))),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => host?.openSystem('store', { view: 'feedback' }) }, ico('send', 15), 'Send feedback')
      ),
      row('lock', 'Privacy', 'Everything stays in your browser. No accounts, no tracking, nothing is uploaded.')
    ),
    h('p', { class: 'small' }, `© ${OS.year} ${OS.author}. Made with care. Released under the MIT License.`)
  );
}
