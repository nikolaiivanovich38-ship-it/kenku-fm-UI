// Checks every text and status token against surfaces in each theme of tokens.css (WCAG 2 contrast).
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8');
const blocks = {}; let m; const re = /(?:\[data-theme="(\w+)"\]|:root, \[data-theme="(\w+)"\])\s*\{([^}]*)\}/g;
while ((m = re.exec(css))) { const t = m[1] || m[2]; blocks[t] = {}; for (const d of m[3].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) blocks[t][d[1]] = d[2]; }
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const hue = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255), x = Math.max(r, g, b), d = x - Math.min(r, g, b);
  return d === 0 ? 0 : x === r ? (60 * ((g - b) / d) + 360) % 360 : x === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240; };
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return Math.min(d, 360 - d); };
let fail = 0;
const text = ['ink', 'ink-2', 'ink-3', 'accent-text', 'onair', 'ok', 'warn', 'danger', 'music', 'amb', 'fx', 'preview', 'mood', 'motif', 'scenetype'];
for (const [t, v] of Object.entries(blocks)) {
  const rows = [];
  for (const k of text) for (const s of ['bg', 'surface', 'surface-2', 'surface-3']) { const r = cr(v[k], v[s]); if (r < 4.5) { rows.push(`${k} on ${s} ${r.toFixed(2)}`); if (s !== 'surface-3' || k.startsWith('ink')) fail++; } }
  const acc = cr(v['accent-ink'], v.accent), hov = cr(v['accent-ink'], v['accent-hover']);
  if (acc < 4.5 || hov < 4.5) { rows.push(`accent-ink on accent ${acc.toFixed(2)} / hover ${hov.toFixed(2)}`); fail++; }
  // A filled button against the page (WCAG 1.4.11, 3:1).
  for (const s of ['bg', 'surface', 'surface-2']) { const r = cr(v.accent, v[s]); if (r < 3) { rows.push(`accent (a button's fill) on ${s} ${r.toFixed(2)}`); fail++; } }
  // Round 10 (look K1; Nik, 18 Nov: Hearth's orange became iron teal, Parchment's oxblood ink blue): the accent stays
  // out of On air's red-orange band, so the red On air light is the one red on the screen.
  const near = hueGap(v.accent, v.onair); if (near < 30) { rows.push(`accent hue is ${near.toFixed(0)}° from On air's red (needs 30° or more)`); fail++; }
  for (const s of ['surface', 'surface-2']) { const r = cr(v.focus, v[s]); if (r < 3) { rows.push(`focus on ${s} ${r.toFixed(2)}`); fail++; } const l = cr(v['line-strong'], v[s]); if (l < 3 && s === 'surface') rows.push(`(line-strong on surface ${l.toFixed(2)}: borders of controls need 3:1)`); }
  console.log(t.padEnd(10), 'ink', cr(v.ink, v.surface).toFixed(1), 'ink-3', cr(v['ink-3'], v.surface).toFixed(1), 'accent', cr(v['accent-text'], v.surface).toFixed(1), rows.length ? '\n   ' + rows.join('\n   ') : 'all pass');
}
process.exit(fail ? 1 : 0);
