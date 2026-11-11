// Builds ../lyre-prototype.html: one self-contained file (fonts, CSS and JS inlined) so it works offline and as an artifact.
const fs = require('fs'), path = require('path');
const src = __dirname, out = path.resolve(src, '..', process.env.OUT || 'lyre-prototype.html');
const rd = f => fs.readFileSync(path.join(src, f), 'utf8');
const ff = (fam, file, w, st) => `@font-face{font-family:"${fam}";font-style:${st || 'normal'};font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(src, 'fonts', file)).toString('base64')}) format("woff2")}`;
const fonts = '<style>' + [
  ff('Atkinson Hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff2', 400), ff('Atkinson Hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff2', 700),
  ff('Atkinson Hyperlegible', 'atkinson-hyperlegible-latin-400-italic.woff2', 400, 'italic'), ff('Barlow Condensed', 'barlow-condensed-latin-600-normal.woff2', 600),
  ff('Lora', 'lora-latin-600-normal.woff2', 600), ff('Cinzel', 'cinzel-latin-600-normal.woff2', 600),
  ff('Cormorant Garamond', 'cormorant-garamond-latin-600-normal.woff2', 600), ff('Cormorant Garamond', 'cormorant-garamond-latin-600-italic.woff2', 600, 'italic')].join('\n') + '</style>';
// Round 7: its files (r7*.js) come last, as they add to what core.js and the screens define; round 8's after them.
const order = ['_shared', 'look', 'campaigns', 'library', 'boards', 'live', 'r7shell', 'r7tags', 'r7org', 'r7play', 'r8window'];
const views = fs.readdirSync(path.join(src, 'views')).sort((a, b) => (order.indexOf(a.split('.')[0]) - order.indexOf(b.split('.')[0])) || a.localeCompare(b));
const css = ['tokens.css', 'ui.css'].map(rd).concat(views.filter(f => f.endsWith('.css')).map(f => rd('views/' + f))).join('\n');
// FND-8: the help articles are the app's own (src/lyre/help/articles/*.md), so the prototype shows the words Lyre ships.
const helpDir = path.resolve(src, '..', '..', '..', 'src', 'lyre', 'help', 'articles');
const mdIn = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') })) : [];
// Round 6 review (Should 12): design/prototype/help-drafts holds the design's new or changed articles; a draft takes
// the place of the app's article with the same file name until the lead copies it into the app.
const drafts = mdIn(path.resolve(src, '..', 'help-drafts'));
const helpFiles = mdIn(helpDir).filter((f) => !drafts.some((d) => d.file === f.file)).concat(drafts).sort((a, b) => a.file.localeCompare(b.file));
const helpData = 'var LYRE_HELP_FILES = ' + JSON.stringify(helpFiles).replace(/<\//g, '<\\/') + ';';
const js = [helpData].concat(['data.js', 'core.js'].map(rd)).concat(views.filter(f => f.endsWith('.js')).map(f => rd('views/' + f))).join('\n;\n');
let h = rd('index.html').replace('<!--@fonts-->', () => fonts).replace('<!--@css-->', () => '<style>\n' + css + '\n</style>').replace('<!--@js-->', () => '<script>\n' + js + '\n</script>');
fs.writeFileSync(out, h); console.log('built', out, Math.round(h.length / 1024) + ' KB', 'views:', views.join(' '));
// Artifact copy (only when ARTIFACT_DIR is given): the host adds its own document skeleton, so the page starts at <title>.
if (process.env.ARTIFACT_DIR) {
  const art = h.replace(/^<!doctype html>\s*<html lang="en">\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<\/head>\s*<body>\s*/i, '\n').replace(/\s*<\/body>\s*<\/html>\s*$/i, '\n');
  fs.writeFileSync(path.resolve(process.env.ARTIFACT_DIR, 'lyre-design-round-2.html'), art);
}
