/* Look and feel: the design language proposal. Each card carries its own data-theme, so it shows the real tokens. */
(function () {
  var esc = L.esc;
  // One plain sentence per theme, for a game master choosing one (w3-ux 8).
  var themes = [
    { id: 'candle', name: 'Candlelit Library', games: 'Lyre\'s default; wizarding schools, academies, mysteries', line: 'Ink blue and candle gold, like a library after dark: Lyre\'s own theme, for any campaign without one.' },
    { id: 'fern', name: 'Fern and Brass', games: "Lyre's own colours; any game", line: 'Green-black and brass, the colours of Lyre\'s logo, calm for long sessions in any world.' },
    { id: 'hearth', name: 'Hearth and Iron', games: 'D&D, Pathfinder, sword and sorcery', line: 'Warm stone and ember light for dungeons, taverns and sword and sorcery.' },
    { id: 'parchment', name: 'Parchment', games: 'The light version of Candlelit Library', line: 'A light theme for preparing in daylight; you can still run the session in a dark one.' },
    { id: 'elysium', name: 'Elysium', games: 'Vampire: the Masquerade, gothic and noir', line: 'Soot black, bone and blood red for gothic and vampire chronicles.' }
  ];
  function sample(t) {
    return '<div class="lk-sample" data-theme="' + t.id + '">' +
      '<div class="lk-head"><span class="pane-title">' + esc(t.name) + '</span><span class="chip accent">' + esc(t.games.split(',')[0]) + '</span></div>' +
      '<div class="lk-row"><span class="lane-dot music"></span><div class="grow"><div class="ellipsis"><b>Ancient sorrow, choir</b></div><div class="progress music"><span style="width:42%"></span></div></div><span class="num muted">1:54</span><button class="btn s" tabindex="-1">' + L.icon('fade', 's') + 'Fade</button></div>' +
      '<div class="lk-row"><span class="lane-dot amb"></span><div class="grow"><div class="ellipsis">Crypt drips</div><div class="progress amb"><span style="width:70%"></span></div></div><span class="badge onair">On air</span></div>' +
      '<div class="chips"><span class="chip mood"><span class="dot"></span>Eerie</span><span class="chip motif"><span class="dot"></span>Drowned Abbess</span><span class="chip scene"><span class="dot"></span>Ritual</span></div>' +
      '<div class="lk-btns"><button class="btn primary" tabindex="-1">Start scene</button><button class="btn" tabindex="-1">Preview</button><button class="btn ghost" tabindex="-1">More</button></div>' +
      '<div class="lk-sw" aria-hidden="true"><i style="background:var(--bg)"></i><i style="background:var(--surface)"></i><i style="background:var(--surface-3)"></i><i style="background:var(--ink)"></i><i style="background:var(--accent)"></i><i style="background:var(--second)"></i></div>' +
      '</div>';
  }
  L.acts.usetheme = function (el) { L.state.theme = el.dataset.theme; L.save(); L.render(); L.toast('Prototype now uses ' + el.dataset.name); };
  L.view('look', {
    nav: 'look',
    notesTitle: 'Design language: what I propose',
    notes: [
      'All five table themes are in, with <b>Candlelit Library as the default</b> (your choice). Each campaign picks a theme, and Lyre switches to it when you open that campaign or run its session.',
      'Prototype strip, Theme: leave it on <b>Each campaign\'s own</b> to see the switching (The Sunken Crown uses Hearth and Iron, The Sixth Year uses Candlelit Library, Ash and Masks uses Elysium). Pick a theme there to force one everywhere.',
      'These stay the same in every theme: the colours for music, ambience, effects and preview, the red On air signal, the focus outline, Atkinson Hyperlegible for reading, and the layout. What you have learned to read does not move.',
      'Every text colour passes WCAG AA (4.5:1) on its background; a check runs over every theme.'
    ],
    render: function () {
      return '<div class="viewhead"><h1>Look and feel</h1><span class="muted">One Lyre, a theme per table</span></div>' +
        '<div class="viewbody"><div class="lk-intro"><p>Each campaign can have its own theme, and Lyre switches to it when you open that campaign. Choose one here to use it everywhere.</p></div>' +
        '<div class="lk-grid">' + themes.map(function (t) {
          return '<article class="lk-card"><header><h2 class="display">' + esc(t.name) + '</h2><span class="muted">' + esc(t.games) + '</span></header>' + sample(t) +
            '<p>' + esc(t.line) + '</p>' +
            '<button class="btn' + (L.state.theme === t.id ? ' primary' : '') + '" data-act="usetheme" data-theme="' + t.id + '" data-name="' + esc(t.name) + '" data-k="use-' + t.id + '">' + (L.state.theme === t.id ? L.icon('check', 's') + 'In use in the prototype' : 'Try it in the prototype') + '</button></article>';
        }).join('') + '</div>' +
        '<h2 class="display lk-h2">Same in every theme</h2><div class="lk-fixed">' +
        '<div><span class="lane-dot music"></span><b>Music</b> blue</div><div><span class="lane-dot amb"></span><b>Ambience</b> teal</div><div><span class="lane-dot fx"></span><b>Effects</b> amber</div><div><span class="lane-dot preview"></span><b>Preview</b> violet: only you hear it</div><div><span class="badge onair">On air</span> what the players hear</div><div><span class="kbd">Tab</span> gold focus outline</div></div>' +
        '</div>';
    }
  });
})();
