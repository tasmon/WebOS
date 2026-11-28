// WebOS — hand-drawn glyphs for the built-in app tiles (48 × 48). Colours come from CSS classes in style.css (.g-*),
// and --c is the tile's own colour, so each glyph is drawn in cream, white and one warm accent on that colour.
const P = (d, c) => `<path class="${c}" d="${d}"/>`;

function awning() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const t0 = 11 + (26 * i) / 6, t1 = 11 + (26 * (i + 1)) / 6, b0 = 5 + (38 * i) / 6, b1 = 5 + (38 * (i + 1)) / 6;
    s += `<polygon class="${i % 2 ? 'g-cream' : 'g-hi'}" points="${t0},9 ${t1},9 ${b1},19 ${b0},19"/>`;
    s += `<circle class="${i % 2 ? 'g-cream' : 'g-hi'}" cx="${(b0 + b1) / 2}" cy="19" r="${(b1 - b0) / 2}"/>`;
  }
  return s;
}
function gear() {
  let s = '<g transform="translate(24 24)">';
  for (let k = 0; k < 8; k++) s += `<rect class="g-cream" x="-3.2" y="-17" width="6.4" height="8.5" rx="1.8" transform="rotate(${k * 45})"/>`;
  return s + '<circle class="g-cream" r="12"/><circle class="g-bg" r="5"/><circle class="g-hi" r="2" /></g>';
}
function blocks() {
  const b = (x, y, c) => `<rect class="${c}" x="${x}" y="${y}" width="8" height="8" rx="2"/>`;
  return [b(14, 7, 'g-cream'), b(23, 7, 'g-cream'), b(32, 7, 'g-cream'), b(23, 16, 'g-cream'), b(5, 25, 'g-hi'), b(5, 34, 'g-hi'), b(14, 34, 'g-hi'), b(23, 34, 'g-wh'), b(32, 34, 'g-wh'), b(32, 25, 'g-wh'), b(14, 25, 'g-wh')].join('');
}

export const TILE_ART = {
  store: awning() + P('M9 22h30v16a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z', 'g-cream') + '<rect class="g-bg" x="20" y="27" width="8" height="13" rx="1.5"/><rect class="g-bg" x="12" y="26" width="5" height="5" rx="1"/><rect class="g-bg" x="31" y="26" width="5" height="5" rx="1"/>',
  globe:
    '<circle class="g-cream" cx="23" cy="23" r="15.5"/><g fill="none" stroke-width="2" class="g-bgs"><ellipse cx="23" cy="23" rx="6.5" ry="15.5"/><path d="M7.5 23h31M10 15.5h26M10 30.5h26"/></g>' +
    '<path class="g-hi g-bgs" stroke-width="2" stroke-linejoin="round" d="M29 26.5 43 32l-6 2.2 3.6 7.2-3.7 1.8-3.6-7.2-4.4 4.6z"/>',
  music: '<rect class="g-cream" x="9" y="24" width="7" height="15" rx="3.5"/><rect class="g-hi" x="20.5" y="10" width="7" height="29" rx="3.5"/><rect class="g-cream" x="32" y="18" width="7" height="21" rx="3.5"/><rect class="g-wh" x="9" y="41.5" width="30" height="2.4" rx="1.2"/>',
  pdf: P('M13 5h16l9 9v27a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'g-cream') + P('M29 5v9h9z', 'g-sh') + '<rect class="g-sh" x="16" y="17" width="12" height="2.6" rx="1.3"/><rect class="g-sh" x="16" y="22" width="16" height="2.6" rx="1.3"/><rect class="g-bg" x="11" y="29" width="27" height="12" rx="1.5"/><text class="g-txt" x="24.5" y="38.6" text-anchor="middle">PDF</text>',
  gamepad: blocks(),
  package: P('M24 6 40 14.5 24 23 8 14.5z', 'g-cream') + P('M8 14.5 24 23v19L8 33.5z', 'g-hi') + P('M40 14.5 24 23v19l16-8.5z', 'g-wh') + '<path class="g-bgs" fill="none" stroke-width="2.6" stroke-linecap="round" d="M16 10.3l16 8.5"/>',
  settings: gear(),
  help: P('M10 13a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H23l-9 8v-8h-1a5 5 0 0 1-3-5z', 'g-cream') + '<text class="g-txt big" x="24" y="27.5" text-anchor="middle">?</text><circle class="g-hi" cx="39" cy="9" r="4.5"/>',
  info: '<circle class="g-hi" cx="24" cy="24" r="19" opacity=".95"/><circle class="g-cream" cx="24" cy="24" r="16"/><circle class="g-bg" cx="24" cy="16.5" r="2.8"/><rect class="g-bg" x="21.4" y="22" width="5.2" height="14" rx="2.6"/>',
  plus: '<path class="g-cream g-fillnone" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M9 30v7a2 2 0 0 0 2 2h26a2 2 0 0 0 2-2v-7"/><path class="g-hi g-fillnone" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" d="M24 8v21M15 21l9 9 9-9"/>',
};
