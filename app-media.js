// WebOS — Media Player: play music and video from your device (or a link), with a playlist.
import { h, ico, toast, pickFile, promptBox } from './ui.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const AUDIO_RX = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
const VIDEO_RX = /\.(mp4|m4v|webm|ogv|mov|mkv)$/i;
const fmt = (s) => {
  if (!isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  const hr = Math.floor(m / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return hr ? `${hr}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const baseName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');

export function buildMedia(host) {
  const root = h('div', { class: 'media accepts-files', tabindex: '0' });
  let items = [];
  let cur = -1;
  let shuffle = false;
  let repeat = 'off'; // off | all | one
  let seeking = false;
  let seq = 0;

  const video = h('video', { class: 'md-video', playsinline: true, preload: 'metadata' });
  const art = h('div', { class: 'md-art' }, h('div', { class: 'md-art-ico' }, ico('music', 54)), h('div', { class: 'md-eq' }, [1, 2, 3, 4, 5].map(() => h('i'))), h('div', { class: 'md-title' }, 'Nothing playing'), h('div', { class: 'md-sub' }, 'Open music or video files to begin'));
  const empty = h('div', { class: 'md-empty' }, h('div', { class: 'st-empty-ico' }, ico('film', 34)), h('h3', null, 'Play your music and videos'), h('p', null, 'Open files from your device, drop them here, or add a link to a media file.'), h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: () => addFiles() }, ico('plus', 16), 'Open files'), h('button', { class: 'btn', onclick: () => addLink() }, ico('link', 16), 'Add a link')));
  const stage = h('div', { class: 'md-stage' }, art, video, empty);

  const playBtn = h('button', { class: 'md-play', type: 'button', 'aria-label': 'Play', title: 'Play / pause (Space)', onclick: () => toggle() }, ico('play', 24));
  const ctl = (icon, title, fn) => h('button', { class: 'btn ghost icon md-b', type: 'button', title, 'aria-label': title, onclick: fn }, ico(icon, 18));
  const prevBtn = ctl('skipprev', 'Previous (P)', () => step(-1, true));
  const nextBtn = ctl('skipnext', 'Next (N)', () => step(1, true));
  const shufBtn = ctl('shuffle', 'Shuffle', () => ((shuffle = !shuffle), paintToggles()));
  const repBtn = ctl('repeat', 'Repeat: off', () => ((repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'), paintToggles()));
  const seek = h('input', { class: 'range md-seek', type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': 'Seek' });
  const tNow = h('span', { class: 'md-t' }, '0:00');
  const tAll = h('span', { class: 'md-t' }, '0:00');
  const muteBtn = ctl('volume', 'Mute (M)', () => ((video.muted = !video.muted), paintVol()));
  const vol = h('input', { class: 'range md-vol', type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': 'Volume' });
  const speed = h('select', { class: 'select md-speed', 'aria-label': 'Speed' }, SPEEDS.map((s) => h('option', { value: s }, s + '×')));
  speed.value = '1';
  const fsBtn = ctl('fullscreen', 'Full screen (F)', () => fullscreen());
  const listBtn = ctl('layout', 'Playlist', () => root.classList.toggle('list-open'));
  const controls = h('div', { class: 'md-ctl' }, h('div', { class: 'md-seekrow' }, tNow, seek, tAll), h('div', { class: 'md-btns' }, shufBtn, prevBtn, playBtn, nextBtn, repBtn, h('span', { class: 'grow' }), muteBtn, vol, speed, fsBtn, listBtn));

  const list = h('div', { class: 'md-list' });
  const side = h(
    'aside',
    { class: 'md-side' },
    h('div', { class: 'md-side-h' }, h('b', null, 'Playlist'), h('span', { class: 'grow' }), h('button', { class: 'btn small', type: 'button', onclick: () => addFiles() }, ico('plus', 14), 'Add'), h('button', { class: 'btn small ghost icon', type: 'button', title: 'Add a link', 'aria-label': 'Add a link', onclick: () => addLink() }, ico('link', 15)), h('button', { class: 'btn small ghost icon', type: 'button', title: 'Clear playlist', 'aria-label': 'Clear playlist', onclick: () => clearAll() }, ico('trash', 15))),
    list
  );
  root.append(h('div', { class: 'md-main' }, stage, controls), side);

  /* ------------------------------------------------------------ playlist */
  function kindOf(file) {
    if (file.type.startsWith('video/') || VIDEO_RX.test(file.name)) return 'video';
    if (file.type.startsWith('audio/') || AUDIO_RX.test(file.name)) return 'audio';
    return null;
  }
  async function addFiles(files) {
    if (!files) files = await pickFile('audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac,.opus,.mp4,.webm,.mkv,.mov', true);
    const ok = [...files].filter((f) => kindOf(f));
    if (!ok.length) return files.length && toast('Those files are not music or video.', { kind: 'error' });
    const startAt = items.length;
    for (const f of ok) items.push({ id: ++seq, name: baseName(f.name), url: URL.createObjectURL(f), kind: kindOf(f), blob: true });
    paintList();
    if (cur < 0) play(startAt);
  }
  async function addLink() {
    const v = await promptBox({ title: 'Add a media link', label: 'Address of an audio or video file', placeholder: 'https://example.com/song.mp3', confirmLabel: 'Add' });
    if (!v) return;
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
      if (!/^https?:$/.test(u.protocol)) throw 0;
    } catch {
      return toast('That is not a valid web address.', { kind: 'error' });
    }
    items.push({ id: ++seq, name: decodeURIComponent(u.pathname.split('/').pop() || u.hostname).replace(/\.[^.]+$/, '') || u.hostname, url: u.href, kind: VIDEO_RX.test(u.pathname) ? 'video' : 'audio', blob: false });
    paintList();
    if (cur < 0) play(items.length - 1);
  }
  function remove(i) {
    const it = items[i];
    if (it.blob) URL.revokeObjectURL(it.url);
    items.splice(i, 1);
    if (i === cur) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      cur = -1;
      if (items.length) play(Math.min(i, items.length - 1));
      else show();
    } else if (i < cur) cur--;
    paintList();
  }
  function clearAll() {
    if (!items.length) return;
    items.forEach((it) => it.blob && URL.revokeObjectURL(it.url));
    items = [];
    cur = -1;
    video.pause();
    video.removeAttribute('src');
    video.load();
    paintList();
    show();
  }
  function paintList() {
    list.replaceChildren(
      ...(items.length
        ? items.map((it, i) => h('div', { class: 'md-item' + (i === cur ? ' on' : ''), onclick: () => play(i) }, ico(it.kind === 'video' ? 'film' : 'music', 16), h('span', { class: 'n' }, it.name), h('button', { class: 'btn ghost icon small', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + it.name, onclick: (e) => (e.stopPropagation(), remove(i)) }, ico('x', 13))))
        : [h('div', { class: 'hint', style: 'padding:1rem' }, 'The playlist is empty.')])
    );
    prevBtn.disabled = nextBtn.disabled = items.length < 2 && repeat !== 'all';
  }

  /* ------------------------------------------------------------ playback */
  function play(i) {
    if (i < 0 || i >= items.length) return;
    cur = i;
    const it = items[i];
    video.src = it.url;
    video.playbackRate = +speed.value;
    video.play().catch(() => {});
    show();
    paintList();
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: it.name, artist: 'WebOS' });
      } catch {}
    }
  }
  function step(dir, manual) {
    if (!items.length) return;
    if (shuffle && items.length > 1) {
      let n;
      do n = Math.floor(Math.random() * items.length);
      while (n === cur);
      return play(n);
    }
    let n = cur + dir;
    if (n >= items.length) {
      if (repeat === 'all' || manual) n = 0;
      else return;
    }
    if (n < 0) n = manual ? items.length - 1 : 0;
    play(n);
  }
  function toggle() {
    if (cur < 0) return items.length ? play(0) : addFiles();
    video.paused ? video.play().catch(() => {}) : video.pause();
  }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen?.().catch(() => {});
  }
  function show() {
    const it = items[cur];
    empty.hidden = items.length > 0;
    art.hidden = !items.length || (it && it.kind === 'video');
    video.hidden = !it || it.kind !== 'video';
    art.querySelector('.md-title').textContent = it ? it.name : 'Nothing playing';
    art.querySelector('.md-sub').textContent = it ? `${cur + 1} of ${items.length}` : 'Open music or video files to begin';
    fsBtn.hidden = !it || it.kind !== 'video';
  }
  function paintToggles() {
    shufBtn.classList.toggle('on', shuffle);
    repBtn.classList.toggle('on', repeat !== 'off');
    repBtn.title = 'Repeat: ' + repeat;
    repBtn.replaceChildren(ico('repeat', 18), repeat === 'one' ? h('b', { class: 'md-one' }, '1') : '');
    paintList();
  }
  function paintVol() {
    muteBtn.replaceChildren(ico(video.muted || video.volume === 0 ? 'mute' : 'volume', 18));
  }

  video.addEventListener('play', () => (playBtn.replaceChildren(ico('pause', 24)), root.classList.add('playing'), playBtn.setAttribute('aria-label', 'Pause')));
  video.addEventListener('pause', () => (playBtn.replaceChildren(ico('play', 24)), root.classList.remove('playing'), playBtn.setAttribute('aria-label', 'Play')));
  video.addEventListener('ended', () => (repeat === 'one' ? (video.currentTime = 0, video.play()) : step(1, false)));
  video.addEventListener('loadedmetadata', () => (tAll.textContent = fmt(video.duration)));
  video.addEventListener('timeupdate', () => {
    tNow.textContent = fmt(video.currentTime);
    if (!seeking && video.duration) seek.value = String((video.currentTime / video.duration) * 1000);
  });
  video.addEventListener('error', () => {
    if (cur >= 0) toast(`“${items[cur].name}” could not be played. The format may not be supported by this browser.`, { kind: 'error' });
  });
  video.addEventListener('click', toggle);
  video.addEventListener('dblclick', fullscreen);
  seek.addEventListener('input', () => ((seeking = true), (tNow.textContent = fmt((seek.value / 1000) * (video.duration || 0)))));
  seek.addEventListener('change', () => {
    if (video.duration) video.currentTime = (seek.value / 1000) * video.duration;
    seeking = false;
  });
  vol.addEventListener('input', () => ((video.volume = +vol.value), (video.muted = false), paintVol()));
  speed.addEventListener('change', () => (video.playbackRate = +speed.value));

  root.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=text], textarea')) return;
    const k = e.key;
    if (k === ' ' && !e.target.matches('button, select')) toggle();
    else if (k === 'ArrowRight' && !e.target.matches('input[type=range], select')) video.currentTime += 5;
    else if (k === 'ArrowLeft' && !e.target.matches('input[type=range], select')) video.currentTime -= 5;
    else if (k === 'ArrowUp' && !e.target.matches('input[type=range], select')) ((video.volume = Math.min(1, video.volume + 0.1)), (vol.value = video.volume), paintVol());
    else if (k === 'ArrowDown' && !e.target.matches('input[type=range], select')) ((video.volume = Math.max(0, video.volume - 0.1)), (vol.value = video.volume), paintVol());
    else if (k === 'm' || k === 'M') ((video.muted = !video.muted), paintVol());
    else if (k === 'f' || k === 'F') fullscreen();
    else if (k === 'n' || k === 'N') step(1, true);
    else if (k === 'p' || k === 'P') step(-1, true);
    else return;
    if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
  });

  // drag & drop files straight onto the player
  root.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      root.classList.add('drop');
    }
  });
  root.addEventListener('dragleave', () => root.classList.remove('drop'));
  root.addEventListener('drop', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove('drop');
    addFiles(e.dataTransfer.files);
  });

  if ('mediaSession' in navigator) {
    const set = (a, f) => {
      try {
        navigator.mediaSession.setActionHandler(a, f);
      } catch {}
    };
    set('play', () => video.play());
    set('pause', () => video.pause());
    set('previoustrack', () => step(-1, true));
    set('nexttrack', () => step(1, true));
  }

  paintToggles();
  paintVol();
  show();

  return {
    el: root,
    open: (files) => addFiles(files),
    destroy() {
      video.pause();
      items.forEach((it) => it.blob && URL.revokeObjectURL(it.url));
      items = [];
      if ('mediaSession' in navigator) {
        for (const a of ['play', 'pause', 'previoustrack', 'nexttrack']) {
          try {
            navigator.mediaSession.setActionHandler(a, null);
          } catch {}
        }
      }
    },
  };
}
