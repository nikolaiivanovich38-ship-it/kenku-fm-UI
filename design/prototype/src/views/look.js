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
  // Round 7: the sample's buttons are pictures of buttons (spans, hidden from screen readers), not controls that do
  // nothing.
  function sample(t) {
    return '<div class="lk-sample" data-theme="' + t.id + '">' +
      '<div class="lk-head"><span class="pane-title">' + esc(t.name) + '</span><span class="chip accent">' + esc(t.games.split(',')[0]) + '</span></div>' +
      '<div class="lk-row"><span class="lane-dot music"></span><div class="grow"><div class="ellipsis"><b>Ancient sorrow, choir</b></div><div class="progress music"><span style="width:42%"></span></div></div><span class="num muted">1:54</span><span class="btn s" aria-hidden="true">' + L.icon('fade', 's') + 'Fade</span></div>' +
      '<div class="lk-row"><span class="lane-dot amb"></span><div class="grow"><div class="ellipsis">Crypt drips</div><div class="progress amb"><span style="width:70%"></span></div></div>' + L.destTag('air', '') + '</div>' +
      '<div class="chips"><span class="chip mood"><span class="dot"></span>Eerie</span><span class="chip motif"><span class="dot"></span>Drowned Abbess</span><span class="chip scene"><span class="dot"></span>Ritual</span></div>' +
      '<div class="lk-btns" aria-hidden="true"><span class="btn primary">Start scene</span><span class="btn">Preview</span><span class="btn ghost">More</span></div>' +
      '<div class="lk-sw" aria-hidden="true"><i style="background:var(--bg)"></i><i style="background:var(--surface)"></i><i style="background:var(--surface-3)"></i><i style="background:var(--ink)"></i><i style="background:var(--accent)"></i><i style="background:var(--second)"></i></div>' +
      '</div>';
  }
  var INTRO = 'Each campaign can have its own theme, and Lyre switches to it when you open that campaign. Choose one here to use it everywhere.';
  /* Round 7, UX-11 and A11Y-6: Display, kept per computer (r7shell.js L.display, L.setDisplay). Density, Text size
     (100 to 200 %), High contrast, and a link to the tag colours, which are set with the tags themselves. */
  function displayHTML() {
    var d = L.display ? L.display() : { density: 'compact', size: 100, contrast: false };
    function radio(v, label, hint) {
      return '<label class="lk-radio" title="' + esc(hint) + '"><input type="radio" name="lk-density" value="' + v + '" data-input="lkdensity" data-k="lk-d-' + v + '"' + (d.density === v ? ' checked' : '') + '><span>' + label + '</span></label>';
    }
    return '<section class="lk-display" aria-label="Display"><h2 class="display lk-h2">Display</h2><div class="lk-drow">' +
      '<div class="lk-dgrp" role="radiogroup" aria-label="Density"><span class="lk-dl" aria-hidden="true">Density</span>' + radio('compact', 'Compact', '28 px controls, 30 px rows: Lyre\'s default') + radio('comfortable', 'Comfortable', 'Larger controls and rows, more space between them') + '</div>' +
      '<label class="lk-dgrp lk-size"><span class="lk-dl">Text size</span><input type="range" min="100" max="200" step="25" value="' + d.size + '" data-input="lksize" data-k="lk-size" aria-valuetext="' + d.size + ' percent"><span class="num lk-sizev" aria-hidden="true">' + d.size + ' %</span></label>' +
      '<label class="lv-switch lk-dgrp" title="Hints and quiet text as strong as the rest, stronger lines, in every theme"><input type="checkbox" role="switch" data-input="lkcontrast" data-k="lk-contrast"' + (d.contrast ? ' checked' : '') + '><span class="lv-switch-t"><b>High contrast</b></span></label>' +
      '<a class="btn s ghost" href="#/tags" data-k="lk-tagcol" title="Each tag group and tag can have a colour; the tag\'s name always shows with it">' + L.icon('tag', 's') + 'Tag colours…</a>' +
      '</div></section>';
  }
  L.inputs.lkdensity = function (el) { if (!el.checked) return; L.setDisplay('density', el.value); L.saved('density ' + (el.value === 'compact' ? 'Compact' : 'Comfortable'), { key: 'lk-density' }); };
  // The size applies when the slider is let go (or on each arrow key, which is a change too).
  L.inputs.lksize = function (el, ev) {
    var v = +el.value; el.setAttribute('aria-valuetext', v + ' percent'); var o = el.parentNode.querySelector('.lk-sizev'); if (o) o.textContent = v + ' %';
    if (ev.type === 'change') { L.setDisplay('size', v); L.saved('text size ' + v + ' %', { key: 'lk-size' }); }
  };
  L.inputs.lkcontrast = function (el) { L.setDisplay('contrast', el.checked); L.saved('high contrast ' + (el.checked ? 'on' : 'off'), { key: 'lk-contrast' }); };
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
      // Round 7: the intro sentence is the page's hover text and description (less to read); Display comes first.
      return '<div class="viewhead"><h1 title="' + esc(INTRO) + '" aria-describedby="lk-intro">Look and feel</h1><p class="sr-only" id="lk-intro">' + esc(INTRO) + '</p></div>' +
        '<div class="viewbody">' + displayHTML() +
        '<div class="lk-grid">' + themes.map(function (t) {
          return '<article class="lk-card"><header><h2 class="display">' + esc(t.name) + '</h2><span class="muted">' + esc(t.games) + '</span></header>' + sample(t) +
            '<p>' + esc(t.line) + '</p>' +
            '<button class="btn' + (L.state.theme === t.id ? ' primary' : '') + '" data-act="usetheme" data-theme="' + t.id + '" data-name="' + esc(t.name) + '" data-k="use-' + t.id + '">' + (L.state.theme === t.id ? L.icon('check', 's') + 'In use in the prototype' : 'Try it in the prototype') + '</button></article>';
        }).join('') + '</div>' +
        '<h2 class="display lk-h2">Same in every theme</h2><div class="lk-fixed">' +
        '<div><span class="lane-dot music"></span><b>Music</b> blue</div><div><span class="lane-dot amb"></span><b>Ambience</b> teal</div><div><span class="lane-dot fx"></span><b>Effects</b> amber</div><div><span class="lane-dot preview"></span><b>Preview</b> violet</div><div>' + L.destTag('air', '') + ' the players hear it (with the room when there are two or more)</div><div>' + L.destTag('you', '') + ' only you hear it, in your headphones</div><div><span class="kbd">Tab</span> gold focus outline</div></div>' +
        '</div>';
    }
  });
})();
