/* Look and feel: the design language proposal. Each card carries its own data-theme, so it shows the real tokens. */
(function () {
  var esc = L.esc;
  var themes = [
    { id: 'candle', name: 'Candlelit Library', games: 'Lyre\'s default; wizarding schools, academies, mysteries', words: 'Ink-blue night, candle gold, parchment and an oxblood ribbon.',
      why: 'Deep ink blue with candle gold, the colours of a library after curfew. Your choice for Lyre\'s default: the Campaigns page, Look and feel and every campaign without a theme of its own use it. An oxblood second colour gives a house-colour accent without clashing with the gold.',
      type: 'Cormorant Garamond headings: an old book face, set a little larger because it is light.' },
    { id: 'fern', name: 'Fern and Brass', games: "Lyre's own colours; any game", words: 'Fern gully at dusk, an old brass instrument by candlelight.',
      why: "Taken straight from the logo, so the app and its icon match. Green-black is calm for four hours of play and suits fantasy, folk horror and historical games alike.",
      type: 'Lora headings: a bookish serif, also the face of the Lyre wordmark.' },
    { id: 'hearth', name: 'Hearth and Iron', games: 'D&D, Pathfinder, sword and sorcery', words: 'Dungeon stone, forge light, a map on a tavern table.',
      why: 'Warm soot-brown surfaces with an ember accent and a verdigris second colour (old copper). Reads as torchlight without turning orange everywhere: ember marks only the selected row, the primary button and the pane being worked on.',
      type: 'Cinzel headings: capitals cut like an inscription over a dungeon door. Used only for titles, never for anything you read at length.' },
    { id: 'parchment', name: 'Parchment', games: 'The light version of Candlelit Library', words: 'Daylight prep at a desk by the window.',
      why: 'For building playlists and tagging in daylight, when a dark screen is hard to read. Lane and status colours are darkened so they keep their contrast on paper. You can use it for prep and still run the session in a dark theme.',
      type: 'Cormorant Garamond headings, oxblood accent, ink text.' },
    { id: 'elysium', name: 'Elysium', games: 'Vampire: the Masquerade, gothic and noir', words: 'Soot black, bone, blood and tarnished gold.',
      why: "Near-black with bone text and blood red in the frame; your actions and selections are in tarnished gold, so they never look like Lyre's red On air signal. Spaced capitals in the headings suggest a court invitation.",
      type: 'Cormorant Garamond in spaced capitals.' }
  ];
  function sample(t) {
    return '<div class="lk-sample" data-theme="' + t.id + '">' +
      '<div class="lk-head"><span class="pane-title">' + esc(t.name) + '</span><span class="chip accent">' + esc(t.games.split(',')[0]) + '</span></div>' +
      '<div class="lk-row"><span class="lane-dot music"></span><div class="grow"><div class="ellipsis"><b>Ancient sorrow, choir</b></div><div class="progress music"><span style="width:42%"></span></div></div><span class="num muted">1:54</span><button class="btn s" tabindex="-1">' + L.icon('fade', 's') + 'Fade</button></div>' +
      '<div class="lk-row"><span class="lane-dot amb"></span><div class="grow"><div class="ellipsis">Crypt drips</div><div class="progress amb"><span style="width:70%"></span></div></div><span class="badge onair">On air</span></div>' +
      '<div class="chips"><span class="chip mood"><span class="dot"></span>Eerie</span><span class="chip motif"><span class="dot"></span>Drowned Abbess</span><span class="chip scene"><span class="dot"></span>Ritual</span></div>' +
      '<div class="lk-btns"><button class="btn primary" tabindex="-1">Start scene</button><button class="btn" tabindex="-1">Preview</button><button class="btn ghost" tabindex="-1">More</button></div>' +
      '<div class="lk-sw" aria-hidden="true"><i style="background:var(--bg)"></i><i style="background:var(--surface)"></i><i style="background:var(--surface-3)"></i><i style="background:var(--ink)"></i><i style="background:var(--accent)"></i><i style="background:var(--second)"></i></div>' +
      '<p class="lk-contrast faint" data-contrast="' + t.id + '"></p></div>';
  }
  L.acts.usetheme = function (el) { L.state.theme = el.dataset.theme; L.save(); L.render(); L.toast('Prototype now uses ' + el.dataset.name); };
  L.view('look', {
    nav: 'look',
    notesTitle: 'Design language: what I propose',
    notes: [
      'All five table themes are in, with <b>Candlelit Library as the default</b> (your choice). Each campaign picks a theme, and Lyre switches to it when you open that campaign or run its session.',
      'Prototype strip, Theme: leave it on <b>Each campaign\'s own</b> to see the switching (The Sunken Crown uses Hearth and Iron, The Sixth Year uses Candlelit Library, Ash and Masks uses Elysium). Pick a theme there to force one everywhere.',
      'These stay the same in every theme: the colours for music, ambience, effects and preview, the red On air signal, the focus outline, Atkinson Hyperlegible for reading, and the layout. What you have learned to read does not move.',
      'Every text colour passes WCAG AA (4.5:1) on its background. The numbers under each card are worked out live from the theme.'
    ],
    render: function () {
      return '<div class="viewhead"><h1>Look and feel</h1><span class="muted">One Lyre, a theme per table</span></div>' +
        '<div class="viewbody"><div class="lk-intro"><p><b>Your choice:</b> all five themes, with Candlelit Library as the default. Each campaign can pick its own table theme. ' +
        'You run games in very different worlds. A glance tells you which campaign is loaded before you fire anything, and the screen fits the mood of the table. ' +
        'Only colour and heading type change: buttons, layout and keys stay in the same places, so nothing has to be relearned between campaigns. ' +
        'The cost is testing five palettes instead of one. A check runs over every theme so a change cannot slip below the contrast floor.</p>' +
        '<p class="muted">Fern and Brass stays as the logo\'s own palette (the icon and installer use it) and as a theme a campaign can choose.</p></div>' +
        '<div class="lk-grid">' + themes.map(function (t) {
          return '<article class="lk-card"><header><h2 class="display">' + esc(t.name) + '</h2><span class="muted">' + esc(t.games) + '</span></header>' + sample(t) +
            '<p class="lk-words"><i>' + esc(t.words) + '</i></p><p>' + esc(t.why) + '</p><p class="faint">' + esc(t.type) + '</p>' +
            '<button class="btn' + (L.state.theme === t.id ? ' primary' : '') + '" data-act="usetheme" data-theme="' + t.id + '" data-name="' + esc(t.name) + '" data-k="use-' + t.id + '">' + (L.state.theme === t.id ? L.icon('check', 's') + 'In use in the prototype' : 'Try it in the prototype') + '</button></article>';
        }).join('') + '</div>' +
        '<h2 class="display lk-h2">Same in every theme</h2><div class="lk-fixed">' +
        '<div><span class="lane-dot music"></span><b>Music</b> blue</div><div><span class="lane-dot amb"></span><b>Ambience</b> teal</div><div><span class="lane-dot fx"></span><b>Effects</b> amber</div><div><span class="lane-dot preview"></span><b>Preview</b> violet: only you hear it</div><div><span class="badge onair">On air</span> what the players hear</div><div><span class="kbd">Tab</span> gold focus outline</div></div>' +
        '<h2 class="display lk-h2">Density</h2><p class="lk-p">Controls are 28 px high and closers 24 px (the WCAG 2.2 minimum), down from 44 px. Body text is 13.5 px Atkinson Hyperlegible, a face made for low-vision readers, so text stays readable at the smaller size. Rows are 30 px, so about twice as many tracks fit in the same height.</p></div>';
    },
    after: function (root) {
      function lum(c) { var m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(function (v) { v = v / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; }
      function cr(a, b) { var x = lum(a), y = lum(b); return ((Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(1); }
      root.querySelectorAll('[data-contrast]').forEach(function (p) {
        var s = p.closest('.lk-sample'), cs = getComputedStyle(s), probe = document.createElement('span'); s.appendChild(probe);
        function col(v) { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; }
        var bg = col('--surface'), r = 'Contrast on panels: text ' + cr(col('--ink'), bg) + ':1, quiet text ' + cr(col('--ink-3'), bg) + ':1, accent text ' + cr(col('--accent-text'), bg) + ':1';
        probe.remove(); p.textContent = r; void cs;
      });
    }
  });
})();
