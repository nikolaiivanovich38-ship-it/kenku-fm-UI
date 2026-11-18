/* Round 9 (ROUND9.md §7, §8): lists. The Library's columns, header sorting and three-state filters are in library.js
   (search for "Round 9"); this file holds what several screens share.

   §8 Playlists
     Dividers everywhere (item 42: "The dividers in playlists need to appear wherever playlists are visible not just in
       the setup prep view"): L.dividersBefore(pl) gives, per track id, the dividers just above it in a manual playlist;
       L.dividerHeading(name, play) draws one as a heading row (_shared.js contentsHTML: the Playlists list, the session
       planner, Add music; live.js: Live's boxes, with Play from here; the queue, r9live.js).
     Order and sort the Playlists list (item 38): Sort (Your order, Name A to Z, Name Z to A, Most tracks, Longest, Most
       used, Newest); in Your order each row has a grip to drag (an exact line shows where it lands) and ⋯ has Move up,
       Move down and Move to top; dragging while another sort is on switches to Your order and says so.
     Drag between lists in the planner (item 32): track rows in any unfolded playlist can be dragged (r7org.js's Drop on
       tray appears, as from the Library), and a scene's Music list and a manual playlist's row take the drop in place
       (data-dropto in campaigns.js). Dropping copies; Shift moves it out of the manual playlist it came from. */
(function () {
  var esc = L.esc, D = L.data;
  L.dividersBefore = function (pl) {
    var out = {}, pending = [];
    if (!pl || pl.kind !== 'manual' || !pl.items) return out;
    pl.items.forEach(function (id) { if (L.isDivider(id)) pending.push(D.dividers[id] || 'Section'); else if (pending.length) { out[id] = pending; pending = []; } });
    return out;
  };
  L.dividerHeading = function (name, play) {
    return '<li class="r9-divh" aria-label="Section: ' + esc(name) + '"><span class="r9-divh-line" aria-hidden="true"></span><b class="ellipsis">' + esc(name) + '</b><span class="r9-divh-line" aria-hidden="true"></span>' +
      (play ? '<button class="btn s ghost r9-divplay" data-act="r9divplay" data-id="' + play.tid + '" data-pl="' + play.pid + '" data-place="' + esc(play.place || '') + '" title="Play ' + esc(name) + ' on air: the playlist from its first track under this heading" aria-label="Play from here: ' + esc(name) + '">' + L.icon('playair', 's') + 'Play from here</button>' : '') + '</li>';
  };
  L.acts.r9divplay = function (el) {
    L.play(el.dataset.id, { playlistId: el.dataset.pl, place: el.dataset.place, fade: L.defaultCrossfade });
    L.toast('On air from ' + L.title(L.track(el.dataset.id)));
  };

  /* ---------- item 38: the Playlists list's order and sort ---------- */
  var SORTS = [['own', 'Your order'], ['az', 'Name A to Z'], ['za', 'Name Z to A'], ['tracks', 'Most tracks'], ['long', 'Longest'], ['used', 'Most used'], ['new', 'Newest']];
  var sort = 'own';
  try { sort = localStorage.getItem('lyre-r9-plsort') || 'own'; } catch (e) { /* storage unavailable */ }
  function len(p) { return L.playlistTracks(p).reduce(function (s, t) { return s + (t.dur || 0); }, 0); }
  L.playlistSorted = function (rows) {
    if (sort === 'own') return rows;
    var by = {
      az: function (a, b) { return a.name.localeCompare(b.name); }, za: function (a, b) { return b.name.localeCompare(a.name); },
      tracks: function (a, b) { return L.playlistTracks(b).length - L.playlistTracks(a).length; }, long: function (a, b) { return len(b) - len(a); },
      used: function (a, b) { return L.usesOfPlaylist(b.id).length - L.usesOfPlaylist(a.id).length; },
      'new': function (a, b) { return D.playlists.indexOf(b) - D.playlists.indexOf(a); }
    }[sort];
    return rows.slice().sort(function (a, b) { return by(a, b) || a.name.localeCompare(b.name); });
  };
  L.playlistSortOwn = function () { return sort === 'own'; };
  L.playlistSortButton = function () {
    var w = SORTS.filter(function (x) { return x[0] === sort; })[0][1];
    return '<button class="btn s" data-act="r9plsort" data-k="pl-sort" aria-haspopup="menu" aria-expanded="false" title="Sort the playlists">' + L.icon('inorder', 's') + '<span class="r9-sortw">' + w + '</span>' + L.icon('chevdown', 's') + '</button>';
  };
  L.acts.r9plsort = function (el) {
    L.menu(el, '<div class="group">Sort the playlists</div>' + SORTS.map(function (x) { return '<button role="menuitemradio" aria-checked="' + (sort === x[0]) + '" data-act="r9plsortset" data-v="' + x[0] + '">' + (sort === x[0] ? L.icon('check', 's') : '<span style="width:14px"></span>') + x[1] + '</button>'; }).join(''), 'Sort the playlists');
  };
  function setSort(v) { sort = v; try { localStorage.setItem('lyre-r9-plsort', v); } catch (e) { /* storage unavailable */ } }
  L.acts.r9plsortset = function (el) { setSort(el.dataset.v); L.closeMenu(); L.render(); var b = document.querySelector('[data-k="pl-sort"]'); if (b) b.focus(); L.say('Playlists: ' + SORTS.filter(function (x) { return x[0] === sort; })[0][1]); };
  // Your order: the order of D.playlists. Moving one keeps the others where they are.
  function moveTo(id, to) {
    var i = D.playlists.map(function (p) { return p.id; }).indexOf(id); if (i < 0) return false;
    to = Math.max(0, Math.min(D.playlists.length - 1, to)); if (to === i) return false;
    var p = D.playlists.splice(i, 1)[0]; D.playlists.splice(to, 0, p);
    L.saved('order of the playlists', { detail: p.name + ' is now ' + (to + 1) + ' of ' + D.playlists.length, key: 'pl-order' });
    return true;
  }
  L.acts.r9plmove = function (el) {
    if (sort !== 'own') { setSort('own'); L.toast('Now in your order'); }
    var id = el.dataset.id, i = D.playlists.map(function (p) { return p.id; }).indexOf(id), to = el.dataset.to === 'top' ? 0 : i + +el.dataset.d;
    L.closeMenu(); if (moveTo(id, to)) L.render();
    var b = document.querySelector('[data-k="more-' + id + '"]'); if (b) b.focus();
  };
  L.playlistMoveItems = function (p) {
    var i = D.playlists.indexOf(p), n = D.playlists.length;
    return '<button role="menuitem" data-act="r9plmove" data-id="' + p.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + '>' + L.icon('chevup', 's') + 'Move up<span class="kbd pl-mk">Alt+↑</span></button>' +
      '<button role="menuitem" data-act="r9plmove" data-id="' + p.id + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + '>' + L.icon('chevdown', 's') + 'Move down<span class="kbd pl-mk">Alt+↓</span></button>' +
      '<button role="menuitem" data-act="r9plmove" data-id="' + p.id + '" data-to="top"' + (i === 0 ? ' disabled' : '') + '>' + L.icon('chevup', 's') + 'Move to the top</button><div class="sep"></div>';
  };
  // Dragging a row by its grip: a line shows exactly where it lands (before the row under the pointer's upper half,
  // after it in the lower half); the drop puts it there.
  var pd = null;
  function clearLines() { document.querySelectorAll('.r9-pl-before, .r9-pl-after, .r9-pl-dragging').forEach(function (n) { n.classList.remove('r9-pl-before', 'r9-pl-after', 'r9-pl-dragging'); }); }
  document.addEventListener('pointerdown', function (e) { var g = e.target.closest && e.target.closest('.r9-plgrip'); if (g) { var li = g.closest('li.pl-item'); if (li) li.dataset.r9grip = '1'; } });
  document.addEventListener('dragstart', function (e) {
    var li = e.target.closest && e.target.closest('li.pl-item'); if (!li || !li.dataset.r9grip) return;
    delete li.dataset.r9grip; pd = { id: li.dataset.pid }; li.classList.add('r9-pl-dragging');
    if (sort !== 'own') { setSort('own'); L.toast('Now in your order'); }
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pd.id); } catch (x) { /* older engines */ }
    e.stopPropagation();
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!pd) return; var li = e.target.closest && e.target.closest('li.pl-item'); if (!li) return;
    e.preventDefault(); e.stopPropagation(); var b = li.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2;
    document.querySelectorAll('.r9-pl-before, .r9-pl-after').forEach(function (n) { n.classList.remove('r9-pl-before', 'r9-pl-after'); });
    if (li.dataset.pid !== pd.id) li.classList.add(after ? 'r9-pl-after' : 'r9-pl-before');
  }, true);
  document.addEventListener('drop', function (e) {
    if (!pd) return; var li = e.target.closest && e.target.closest('li.pl-item'); var d = pd; pd = null; clearLines(); if (!li) return;
    e.preventDefault(); e.stopPropagation();
    var ids = D.playlists.map(function (p) { return p.id; }), from = ids.indexOf(d.id), at = ids.indexOf(li.dataset.pid), b = li.getBoundingClientRect();
    var to = at + (e.clientY > b.top + b.height / 2 ? 1 : 0); if (to > from) to--;
    if (moveTo(d.id, to)) L.render();
  }, true);
  document.addEventListener('dragend', function () { if (pd) { pd = null; clearLines(); } }, true);
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || L.current().name !== 'playlists') return;
    var li = e.target.closest && e.target.closest('li.pl-item'); if (!li || L.typing(e.target)) return;
    e.preventDefault(); if (sort !== 'own') { setSort('own'); L.toast('Now in your order'); }
    var id = li.dataset.pid, i = D.playlists.map(function (p) { return p.id; }).indexOf(id), k = document.activeElement.dataset.k;
    if (moveTo(id, i + (e.key === 'ArrowUp' ? -1 : 1))) { L.render(); var n = k && document.querySelector('[data-k="' + k + '"]'); if (n) n.focus(); }
  }, true);
})();
