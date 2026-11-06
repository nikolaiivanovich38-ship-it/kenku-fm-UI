/* Round 7, DAT-10: tag groups. The Tags screen (#/tags; Library › ⋯ › Tags and groups…, and Look and feel › Tag
   colours…) keeps the vocabulary tidy: groups (Mood, Leitmotif, Scene type and any of the game master's own), each
   with its tags, in the order chosen; a colour per group and, if wanted, per tag; a tag inside another (Leitmotif ›
   Villains › Ashen King); other words for a tag (typing "sad" offers Melancholy). Rename, Merge into… and Delete…
   change every track, and every dynamic playlist rule that names the tag, in one step that Undo takes back.

   The data (for the lead's contract; src/common/domain has groups and values already):
     D.tagGroups   [{ id, name, cls, color }] in the order shown; color is a colour name from L.colors or ''
     D.tagValues   { groupId: [tag, …] } in the order shown
     D.tagMeta     { groupId: { tag: { parent, also: [words], color } } }   parent is another tag of the same group
   Helpers used by the other screens:
     L.trackHasTag(t, group, tag)   the track has the tag or a tag inside it (filters and dynamic rules use this)
     L.tagAlso(group, tag)          its other words
     L.tagInside(group, tag)        the tags inside it, at every depth
   Colour is never the only signal: a tag's name is always shown with its colour dot. */
(function () {
  var esc = L.esc, D = L.data;
  var COLOURS = Object.keys(L.colors); // steel, ember, gold, moss, violet, plum, sea, bone
  function colourName(c) { return c ? c[0].toUpperCase() + c.slice(1) : ''; }
  D.tagMeta = D.tagMeta || { mood: { Melancholy: { also: ['sad', 'sorrowful'] }, Dread: { also: ['fear', 'horror'] }, Tense: { also: ['suspense'] } },
    motif: { 'Ashen King': { parent: 'Villains' }, 'Drowned Abbess': { parent: 'Villains' } }, scene: {} };
  // The sample's villains get a tag to hold them (Leitmotif › Villains › Ashen King).
  if (D.tagValues.motif.indexOf('Villains') < 0) D.tagValues.motif.splice(1, 0, 'Villains');

  function meta(g, v, make) { if (!D.tagMeta[g]) D.tagMeta[g] = {}; if (!D.tagMeta[g][v] && make) D.tagMeta[g][v] = {}; return D.tagMeta[g][v] || {}; }
  function group(id) { return D.tagGroups.filter(function (g) { return g.id === id; })[0]; }
  L.tagAlso = function (g, v) { return meta(g, v).also || []; };
  L.tagParent = function (g, v) { return meta(g, v).parent || ''; };
  L.tagInside = function (g, v) {
    var out = []; (D.tagValues[g] || []).forEach(function (x) { if (L.tagParent(g, x) === v) out.push(x); });
    return out.reduce(function (a, x) { return a.concat([x], L.tagInside(g, x)); }, []);
  };
  L.trackHasTag = function (t, g, v) { var have = (t && t.tags[g]) || []; return have.indexOf(v) > -1 || L.tagInside(g, v).some(function (x) { return have.indexOf(x) > -1; }); };
  function count(g, v) { return D.tracks.filter(function (t) { return L.trackHasTag(t, g, v); }).length; }
  function own(g, v) { return D.tracks.filter(function (t) { return (t.tags[g] || []).indexOf(v) > -1; }); }
  // The values in the order shown: each tag followed by the tags inside it.
  function ordered(g) {
    var vals = D.tagValues[g] || [], out = [];
    function add(v, depth) { out.push({ v: v, depth: depth }); vals.forEach(function (x) { if (L.tagParent(g, x) === v) add(x, depth + 1); }); }
    vals.forEach(function (v) { var p = L.tagParent(g, v); if (!p || vals.indexOf(p) < 0) add(v, 0); });
    return out;
  }

  /* Colours: a style sheet made from the choices, so every chip with a dot (Library, playlists, scenes, Live) shows it. */
  function paintColours() {
    var css = '';
    D.tagGroups.forEach(function (g) {
      if (g.color && L.colors[g.color]) css += '.chip.' + g.cls + ' .dot{background:' + L.colors[g.color] + '}';
      Object.keys(D.tagMeta[g.id] || {}).forEach(function (v) { var c = meta(g.id, v).color; if (c && L.colors[c]) css += '.chip[data-tag="' + g.id + ':' + v.replace(/["\\]/g, '') + '"] .dot{background:' + L.colors[c] + '}'; });
    });
    var el = document.getElementById('lyre-tagcolours'); if (!el) { el = document.createElement('style'); el.id = 'lyre-tagcolours'; document.head.appendChild(el); }
    el.textContent = css;
  }
  var render0 = L.render; L.render = function () { paintColours(); render0.apply(L, arguments); };

  /* ---------- changing the vocabulary: every track and rule in one step, with Undo ---------- */
  function snapshot() {
    var was = JSON.parse(JSON.stringify({ g: D.tagGroups, v: D.tagValues, m: D.tagMeta, t: D.tracks.map(function (t) { return [t.id, t.tags]; }), r: D.playlists.map(function (p) { return [p.id, p.rule || null]; }), f: L.libTagFilters ? L.libTagFilters() : {} }));
    return function () {
      D.tagGroups.splice.apply(D.tagGroups, [0, D.tagGroups.length].concat(was.g));
      [[D.tagValues, was.v], [D.tagMeta, was.m]].forEach(function (x) { Object.keys(x[0]).forEach(function (k) { delete x[0][k]; }); Object.assign(x[0], x[1]); });
      was.t.forEach(function (x) { var t = L.track(x[0]); if (t) t.tags = x[1]; });
      was.r.forEach(function (x) { var p = L.playlist(x[0]); if (p && x[1]) p.rule = x[1]; });
      if (L.libTagFilters) { var f = L.libTagFilters(); Object.keys(f).forEach(function (k) { delete f[k]; }); Object.assign(f, was.f); }
    };
  }
  // to: the new name, or '' to take the tag off.
  function retag(g, from, to) {
    var n = 0;
    D.tracks.forEach(function (t) {
      var a = t.tags[g] || [], i = a.indexOf(from); if (i < 0) return; n++;
      a.splice(i, 1); if (to && a.indexOf(to) < 0) a.splice(i, 0, to);
    });
    D.playlists.forEach(function (p) {
      (p.rule && p.rule.conds || []).forEach(function (c) { if (c.group !== g) return; var i = c.values.indexOf(from); if (i < 0) return; c.values.splice(i, 1); if (to && c.values.indexOf(to) < 0) c.values.splice(i, 0, to); });
    });
    var f = L.libTagFilters && L.libTagFilters()[g]; if (f) { var j = f.indexOf(from); if (j > -1) { f.splice(j, 1); if (to && f.indexOf(to) < 0) f.push(to); } }
    (D.tagValues[g] || []).forEach(function (x) { if (L.tagParent(g, x) === from) { if (to) meta(g, x, true).parent = to; else delete meta(g, x, true).parent; } });
    return n;
  }
  function tracks(n) { return n + ' track' + (n === 1 ? '' : 's'); }
  function done(text, undo, focusK) { L.undoNote(text, undo); L.closeSheet(); L.render(); L.say(text + '. Undo is above the Now playing bar, or press Ctrl+Z.'); var f = focusK && document.querySelector('[data-k="' + focusK + '"]'); if (f) f.focus(); }
  function field(id, label, value, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" value="' + esc(value || '') + '" autocomplete="off"' + (extra || '') + '></div>'; }
  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function sheet(title, body, okLabel, act, data) {
    L.sheet({ title: title, body: body, footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="' + act + '" ' + (data || '') + '>' + okLabel + '</button>' });
    var f = document.querySelector('#lyre-sheet .body input, #lyre-sheet .body select'); if (f) { f.focus(); if (f.select) f.select(); }
  }
  function tagSelect(id, label, g, skip, first) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><select class="input" id="' + id + '">' + (first ? '<option value="">' + esc(first) + '</option>' : '') +
      ordered(g).filter(function (x) { return skip.indexOf(x.v) < 0; }).map(function (x) { return '<option value="' + esc(x.v) + '">' + (x.depth ? '\u2003'.repeat(x.depth) : '') + esc(x.v) + '</option>'; }).join('') + '</select></div>';
  }
  function d(el) { return 'data-g="' + esc(el.dataset.g) + '" data-v="' + esc(el.dataset.v || '') + '"'; }

  L.acts.tgrename = function (el) { var v = el.dataset.v; sheet('Rename ' + v, field('tg-name', 'Name', v), 'Rename', 'tgrenameok', d(el)); };
  L.acts.tgrenameok = function (el) {
    var g = el.dataset.g, v = el.dataset.v, to = val('tg-name'); if (!to || to === v) { L.closeSheet(); return; }
    if ((D.tagValues[g] || []).indexOf(to) > -1) { L.toast(to + ' is already a tag here: use Merge into… instead'); return; }
    var undo = snapshot(), n = retag(g, v, to), vals = D.tagValues[g]; vals[vals.indexOf(v)] = to;
    if (D.tagMeta[g] && D.tagMeta[g][v]) { D.tagMeta[g][to] = D.tagMeta[g][v]; delete D.tagMeta[g][v]; }
    done('Renamed ' + v + ' to ' + to + ' on ' + tracks(n), undo, 'tg-more-' + g + '-' + to);
  };
  L.acts.tgmerge = function (el) { var g = el.dataset.g, v = el.dataset.v; sheet('Merge ' + v, tagSelect('tg-into', 'Merge ' + v + ' into', g, [v].concat(L.tagInside(g, v))) + '<p class="hint">Its tracks get the other tag. Typing ' + esc(v.toLowerCase()) + ' still finds it.</p>', 'Merge', 'tgmergeok', d(el)); };
  L.acts.tgmergeok = function (el) {
    var g = el.dataset.g, v = el.dataset.v, to = val('tg-into'); if (!to) return;
    var undo = snapshot(), n = retag(g, v, to), vals = D.tagValues[g]; vals.splice(vals.indexOf(v), 1);
    var m = meta(g, to, true); m.also = (m.also || []).concat([v.toLowerCase()], L.tagAlso(g, v)).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (D.tagMeta[g]) delete D.tagMeta[g][v];
    done('Merged ' + v + ' into ' + to + ' on ' + tracks(n), undo, 'tg-more-' + g + '-' + to);
  };
  L.acts.tgdel = function (el) {
    var g = el.dataset.g, v = el.dataset.v, n = own(g, v).length, kids = L.tagInside(g, v).filter(function (x) { return L.tagParent(g, x) === v; });
    sheet('Delete ' + v + '?', '<p>It comes off ' + tracks(n) + '.' + (kids.length ? ' ' + esc(kids.join(', ')) + ' move' + (kids.length === 1 ? 's' : '') + ' up a level.' : '') + '</p>', 'Delete', 'tgdelok', d(el));
  };
  L.acts.tgdelok = function (el) {
    var g = el.dataset.g, v = el.dataset.v, undo = snapshot(), up = L.tagParent(g, v);
    // The tags that were inside it move up a level, to where it was.
    D.tagValues[g].forEach(function (x) { if (L.tagParent(g, x) === v) { if (up) meta(g, x, true).parent = up; else delete meta(g, x, true).parent; } });
    var n = retag(g, v, '');
    D.tagValues[g].splice(D.tagValues[g].indexOf(v), 1); if (D.tagMeta[g]) delete D.tagMeta[g][v];
    done('Deleted ' + v + ' from ' + tracks(n), undo, 'tg-add-' + g);
  };
  L.acts.tgparent = function (el) { var g = el.dataset.g, v = el.dataset.v; sheet('Put ' + v + ' inside', tagSelect('tg-in', 'Inside', g, [v].concat(L.tagInside(g, v)), 'Nothing: a tag of its own'), 'Done', 'tgparentok', d(el));
    var s = document.getElementById('tg-in'); if (s) s.value = L.tagParent(g, v); };
  L.acts.tgparentok = function (el) {
    var g = el.dataset.g, v = el.dataset.v, p = val('tg-in'), m = meta(g, v, true); if (p) m.parent = p; else delete m.parent;
    L.closeSheet(); L.render(); L.saved(p ? v + ' inside ' + p : v + ' as a tag of its own');
  };
  L.acts.tgalso = function (el) { var g = el.dataset.g, v = el.dataset.v; sheet('Other words for ' + v, field('tg-also', 'Other words, separated by commas', L.tagAlso(g, v).join(', '), ' placeholder="For example sad, sorrowful"') + '<p class="hint">Typing one of them while tagging offers ' + esc(v) + '.</p>', 'Done', 'tgalsook', d(el)); };
  L.acts.tgalsook = function (el) {
    var g = el.dataset.g, v = el.dataset.v, words = val('tg-also').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    meta(g, v, true).also = words; L.closeSheet(); L.render(); L.saved('other words for ' + v);
  };
  function colourSheet(title, cur, own, act, data) {
    var opts = (own ? [['', 'The group\'s colour']] : [['', 'None']]).concat(COLOURS.map(function (c) { return [c, colourName(c)]; }));
    L.sheet({ title: title, body: '<div class="tg-colours" role="radiogroup" aria-label="Colour">' + opts.map(function (o) {
      return '<label class="lk-radio tg-col"><input type="radio" name="tg-col" value="' + o[0] + '"' + ((cur || '') === o[0] ? ' checked' : '') + '><span class="tg-sw" style="background:' + (o[0] ? L.colors[o[0]] : 'transparent') + '" aria-hidden="true"></span><span>' + esc(o[1]) + '</span></label>';
    }).join('') + '</div><p class="hint">The name always shows with its colour.</p>', footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="' + act + '" ' + data + '>Done</button>' });
    var f = document.querySelector('#lyre-sheet input:checked'); if (f) f.focus();
  }
  function chosen() { var c = document.querySelector('#lyre-sheet input[name=tg-col]:checked'); return c ? c.value : ''; }
  L.acts.tgcolour = function (el) { colourSheet('Colour of ' + el.dataset.v, meta(el.dataset.g, el.dataset.v).color, true, 'tgcolourok', d(el)); };
  L.acts.tgcolourok = function (el) { var c = chosen(), m = meta(el.dataset.g, el.dataset.v, true); if (c) m.color = c; else delete m.color; L.closeSheet(); L.render(); L.saved(el.dataset.v + ' colour'); };
  L.acts.tggcolour = function (el) { var g = group(el.dataset.g); colourSheet('Colour of ' + g.name, g.color, false, 'tggcolourok', d(el)); };
  L.acts.tggcolourok = function (el) { var g = group(el.dataset.g); g.color = chosen(); L.closeSheet(); L.render(); L.saved(g.name + ' colour'); };
  function move(list, item, by) { var i = list.indexOf(item), j = i + by; if (i < 0 || j < 0 || j >= list.length) return false; list.splice(i, 1); list.splice(j, 0, item); return true; }
  L.acts.tgmove = function (el) {
    var g = el.dataset.g, v = el.dataset.v, by = +el.dataset.by, vals = D.tagValues[g], p = L.tagParent(g, v);
    // Among the tags at the same level (the same parent): swap with the next one there.
    var same = vals.filter(function (x) { return L.tagParent(g, x) === p; }), k = same.indexOf(v), other = same[k + by]; if (!other) return;
    vals.splice(vals.indexOf(v), 1); vals.splice(vals.indexOf(other) + (by > 0 ? 1 : 0), 0, v);
    L.render(); L.saved('order of ' + group(g).name + ' tags', { key: 'tg-ord-' + g });
  };
  L.acts.tggmove = function (el) { var g = group(el.dataset.g); if (move(D.tagGroups, g, +el.dataset.by)) { L.render(); L.saved('order of tag groups', { key: 'tg-gord' }); var f = document.querySelector('[data-k="tg-gmore-' + g.id + '"]'); if (f) f.focus(); } };
  L.acts.tggrename = function (el) { var g = group(el.dataset.g); sheet('Rename the ' + g.name + ' group', field('tg-name', 'Name', g.name), 'Rename', 'tggrenameok', d(el)); };
  L.acts.tggrenameok = function (el) { var g = group(el.dataset.g), to = val('tg-name'); if (to) g.name = to; L.closeSheet(); L.render(); if (to) L.saved('group name “' + to + '”'); };
  L.acts.tggdel = function (el) {
    var g = group(el.dataset.g), n = D.tracks.filter(function (t) { return (t.tags[g.id] || []).length; }).length;
    sheet('Delete the ' + g.name + ' group?', '<p>Its ' + (D.tagValues[g.id] || []).length + ' tags come off ' + tracks(n) + '.</p>', 'Delete', 'tggdelok', d(el));
  };
  L.acts.tggdelok = function (el) {
    var g = group(el.dataset.g), undo = snapshot(), n = 0;
    D.tracks.forEach(function (t) { if ((t.tags[g.id] || []).length) n++; t.tags[g.id] = []; });
    D.playlists.forEach(function (p) { if (p.rule && p.rule.conds) p.rule.conds = p.rule.conds.filter(function (c) { return c.group !== g.id; }); });
    D.tagGroups.splice(D.tagGroups.indexOf(g), 1);
    done('Deleted the ' + g.name + ' group from ' + tracks(n), undo, 'tg-newgroup');
  };
  L.acts.tgnewgroup = function () { sheet('New group', field('tg-name', 'Name', '', ' placeholder="For example Faction"'), 'Add group', 'tgnewgroupok', ''); };
  L.acts.tgnewgroupok = function () {
    var name = val('tg-name'); if (!name) { L.toast('Give the group a name'); return; }
    var id = 'g' + L.uid('').slice(0, 5), g = { id: id, name: name, cls: 'tg-' + id, color: COLOURS[D.tagGroups.length % COLOURS.length] };
    D.tagGroups.push(g); D.tagValues[id] = []; D.tagMeta[id] = {}; D.tracks.forEach(function (t) { if (!t.tags[id]) t.tags[id] = []; });
    if (L.libTagFilters) L.libTagFilters()[id] = [];
    L.closeSheet(); L.render(); L.saved('tag group “' + name + '”'); var f = document.querySelector('[data-k="tg-add-' + id + '"]'); if (f) f.focus();
  };
  L.acts.tgadd = function (el) { var g = group(el.dataset.g); sheet('Add a tag to ' + g.name, field('tg-name', 'Name', '') + (D.tagValues[g.id].length ? tagSelect('tg-in', 'Inside', g.id, [], 'Nothing: a tag of its own') : ''), 'Add tag', 'tgaddok', d(el)); };
  L.acts.tgaddok = function (el) {
    var g = el.dataset.g, name = val('tg-name'), p = val('tg-in'); if (!name) { L.toast('Give the tag a name'); return; }
    if (D.tagValues[g].indexOf(name) > -1) { L.toast(name + ' is already here'); return; }
    D.tagValues[g].push(name); if (p) meta(g, name, true).parent = p;
    L.closeSheet(); L.render(); L.saved('tag “' + name + '” in ' + group(g).name); var f = document.querySelector('[data-k="tg-more-' + g + '-' + name + '"]'); if (f) f.focus();
  };
  L.acts.tgmenu = function (el) {
    var g = el.dataset.g, v = el.dataset.v, p = L.tagParent(g, v), same = D.tagValues[g].filter(function (x) { return L.tagParent(g, x) === p; }), i = same.indexOf(v), dd = d(el);
    function item(act, label, icon, extra) { return '<button role="menuitem" data-act="' + act + '" ' + dd + (extra || '') + '>' + L.icon(icon, 's') + label + '</button>'; }
    L.menu(el, item('tgrename', 'Rename…', 'edit') + item('tgmerge', 'Merge into…', 'link') + item('tgparent', 'Put inside…', 'folder') + item('tgalso', 'Other words…', 'search') + item('tgcolour', 'Colour…', 'palette') +
      (i > 0 ? item('tgmove', 'Move up', 'chevup', ' data-by="-1"') : '') + (i < same.length - 1 ? item('tgmove', 'Move down', 'chevdown', ' data-by="1"') : '') +
      '<div class="sep"></div>' + item('tgdel', 'Delete…', 'trash'), 'More for ' + v);
  };
  L.acts.tggmenu = function (el) {
    var g = group(el.dataset.g), i = D.tagGroups.indexOf(g), dd = d(el);
    function item(act, label, icon, extra) { return '<button role="menuitem" data-act="' + act + '" ' + dd + (extra || '') + '>' + L.icon(icon, 's') + label + '</button>'; }
    L.menu(el, item('tggrename', 'Rename group…', 'edit') + item('tggcolour', 'Colour…', 'palette') +
      (i > 0 ? item('tggmove', 'Move up', 'chevup', ' data-by="-1"') : '') + (i < D.tagGroups.length - 1 ? item('tggmove', 'Move down', 'chevdown', ' data-by="1"') : '') +
      '<div class="sep"></div>' + item('tggdel', 'Delete group…', 'trash'), 'More for the ' + g.name + ' group');
  };
  // First use (DAT-10): with no groups left, Lyre offers its starting vocabulary again.
  var STARTER = { mood: ['Melancholy', 'Heroic', 'Tense', 'Wistful', 'Warm', 'Triumphant', 'Eerie'], motif: [], scene: ['Combat', 'Exploration', 'Tavern', 'Travel', 'Rest'] };
  L.acts.tgstarter = function () {
    [['mood', 'Mood'], ['motif', 'Leitmotif'], ['scene', 'Scene type']].forEach(function (x) { if (!group(x[0])) { D.tagGroups.push({ id: x[0], name: x[1], cls: x[0], color: '' }); D.tagValues[x[0]] = STARTER[x[0]].slice(); } });
    L.render(); L.saved('Lyre\'s starting tags');
  };

  /* ---------- the screen ---------- */
  function row(g, x) {
    var v = x.v, n = count(g.id, v), p = L.tagParent(g.id, v), also = L.tagAlso(g.id, v), col = meta(g.id, v).color, did = 'tgd-' + g.id + '-' + v.replace(/\W/g, '_');
    var words = (p ? 'Inside ' + p + '. ' : '') + (also.length ? 'Also found by: ' + also.join(', ') + '. ' : '') + tracks(n) + '.';
    return '<li class="tg-row" style="--depth:' + x.depth + '" aria-describedby="' + did + '" title="' + esc(words) + '"><span class="chip ' + g.cls + ' tg-chip" data-tag="' + esc(g.id + ':' + v) + '"><span class="dot"' + (col ? ' style="background:' + L.colors[col] + '"' : '') + '></span><span class="ellipsis">' + esc(v) + '</span></span>' +
      '<span class="sr-only" id="' + did + '">' + esc(words) + '</span><span class="grow"></span><span class="num faint" aria-hidden="true">' + n + '</span>' +
      '<button class="closer" data-act="tgmenu" data-g="' + g.id + '" data-v="' + esc(v) + '" data-k="tg-more-' + g.id + '-' + esc(v) + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for ' + esc(v) + '">' + L.icon('more') + '</button></li>';
  }
  function groupBox(g) {
    var list = ordered(g.id);
    return L.pane({ id: 'tg-' + g.id, title: g.name, icon: 'tag', kind: 'plain', noMax: true, size: 'auto', cls: 'tg-pane', describe: list.length + ' tags' + (g.color ? ', colour ' + colourName(g.color) : ''),
      actions: '<button class="btn s" data-act="tgadd" data-g="' + g.id + '" data-k="tg-add-' + g.id + '">' + L.icon('plus', 's') + 'Add tag</button>' +
        '<button class="closer" data-act="tggmenu" data-g="' + g.id + '" data-k="tg-gmore-' + g.id + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for the ' + esc(g.name) + ' group">' + L.icon('more') + '</button>',
      body: list.length ? '<ul class="list tg-list" aria-label="' + esc(g.name) + ' tags">' + list.map(function (x) { return row(g, x); }).join('') + '</ul>' : '<p class="empty">No tags yet.</p>' });
  }
  L.view('tags', {
    nav: 'library', title: function () { return 'Tags'; },
    notesTitle: 'Tags (round 7, DAT-10)',
    notes: [
      'One box per <b>group</b>, in your order (⋯ › Move up, Move down). <b>Add tag</b> in each box; <b>New group</b> at the top.',
      'A tag\'s ⋯: <b>Rename…</b>, <b>Merge into…</b>, <b>Put inside…</b> (Leitmotif › Villains › Ashen King), <b>Other words…</b> (try typing "sad" in a track\'s Mood), <b>Colour…</b>, <b>Delete…</b>. Rename, merge and delete change every track and dynamic playlist rule at once, with Undo.',
      'Filtering by a tag that holds others finds their tracks too (Library › Filters › Leitmotif › Villains).'
    ],
    render: function () {
      return '<div class="viewhead"><h1>Tags</h1><span class="grow"></span><button class="btn" data-act="tgnewgroup" data-k="tg-newgroup">' + L.icon('plus', 's') + 'New group</button></div>' +
        '<div class="viewbody tg-body">' + (D.tagGroups.length ? '<div class="tg-grid">' + D.tagGroups.map(groupBox).join('') + '</div>'
          : '<div class="empty"><b>No tag groups.</b> <button class="btn s" data-act="tgstarter" data-k="tg-starter">Use Lyre\'s starting tags</button></div>') + '</div>';
    }
  });
})();
