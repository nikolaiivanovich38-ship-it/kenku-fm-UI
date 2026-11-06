/* Lyre design round 2: sample data.
   Model: Campaign > Session > Scene. Playlists and pad boards live on their own (Library) and are assigned
   to a campaign, a session or a scene. A scene names its music playlists (first one starts when the scene starts),
   its ambience playlist and its pad board. Tracks keep three names: the title you gave it, the title in the
   file's tags (metadata) and the file name, plus the folder it is in. */
var LYRE_DATA = (function () {
  var tagGroups = [
    { id: 'mood', name: 'Mood', cls: 'mood' },
    { id: 'motif', name: 'Leitmotif', cls: 'motif' },
    { id: 'scene', name: 'Scene type', cls: 'scene' }
  ];
  var tagValues = {
    mood: ['Heroic', 'Triumphant', 'Warm', 'Pastoral', 'Playful', 'Hopeful', 'Epic', 'Sacred', 'Wistful', 'Mysterious', 'Melancholy', 'Desperate', 'Tense', 'Grief', 'Eerie', 'Dread'],
    motif: ['The Company', 'Drowned Abbess', 'Ashen King', 'Greyhollow'],
    scene: ['Combat', 'Exploration', 'Tavern', 'Travel', 'Revelation', 'Chase', 'Ritual', 'Rest']
  };

  // [id, your title (empty = none yet), composer, album, file, seconds, moods, motifs, scenes, energy, role, loop]
  var raw = [
    ['t01', "Very short heroic moment: build. Cool vibe! (Don't loop, use as a sting, cue something up after)", 'Basil Poledouris', 'Conan the Barbarian', '1-11 Riders of Doom.flac', 95, ['Heroic', 'Epic'], ['The Company'], ['Combat'], 4, 'Sting', 'no'],
    ['t02', 'Melancholy tense - melancholy heroism - fade', 'Hans Zimmer', 'The Thin Red Line', '04 Journey to the Line.flac', 558, ['Melancholy', 'Tense', 'Heroic'], [], ['Exploration', 'Revelation'], 3, 'Underscore', 'no'],
    ['t03', 'Tense Moderate Energy, Wistful, some warmth (short - loops well). Swells.', 'Jeremy Soule', 'The Elder Scrolls V: Skyrim', '2-03 Secunda.flac', 146, ['Tense', 'Wistful', 'Warm'], [], ['Exploration', 'Travel'], 3, 'Loop bed', 'yes'],
    ['t04', "Desperate flight, huge choir, relentless. Combat climax only (don't loop)", 'Howard Shore', 'The Fellowship of the Ring (Complete Recordings)', '3-04 The Bridge of Khazad-dum.flac', 357, ['Desperate', 'Epic', 'Tense'], [], ['Combat', 'Chase'], 5, 'Underscore', 'no'],
    ['t05', 'Warm pastoral, gentle bounce, homely (loops well) - village, inn', 'Howard Shore', 'The Fellowship of the Ring (Complete Recordings)', '1-02 Concerning Hobbits.flac', 175, ['Warm', 'Pastoral', 'Playful'], ['Greyhollow'], ['Tavern', 'Rest'], 2, 'Loop bed', 'yes'],
    ['t06', 'Brutal battle, driving brass and strings; long build to full war', 'Hans Zimmer & Lisa Gerrard', 'Gladiator', '03 The Battle.flac', 602, ['Tense', 'Epic', 'Desperate'], [], ['Combat'], 5, 'Underscore', 'crossfade'],
    ['t07', 'Release after loss, ethereal voice, resolves - end of session or death of an NPC', 'Hans Zimmer & Lisa Gerrard', 'Gladiator', '17 Now We Are Free.flac', 254, ['Grief', 'Hopeful', 'Sacred'], [], ['Rest', 'Revelation'], 2, 'Underscore', 'no'],
    ['t08', 'Heroic charge - horns, gallop, full orchestra. Turning point in a fight', 'Howard Shore', 'The Two Towers', '2-12 Forth Eorlingas.flac', 195, ['Heroic', 'Triumphant', 'Epic'], ['The Company'], ['Combat'], 5, 'Underscore', 'no'],
    ['t09', 'Quiet grief, solo voice - a fallen companion', 'Howard Shore', 'The Two Towers', '1-10 Evenstar.flac', 195, ['Grief', 'Melancholy'], [], ['Rest'], 1, 'Underscore', 'no'],
    ['t10', 'Grand city, noble but threatened - arriving somewhere important', 'Howard Shore', 'The Return of the King', '04 Minas Tirith.flac', 217, ['Epic', 'Heroic', 'Tense'], [], ['Travel', 'Revelation'], 4, 'Underscore', 'no'],
    ['t11', 'Wild chase through forest, strings ostinato, never lets up', 'Trevor Jones', 'The Last of the Mohicans', '01 Main Title - Promentory.flac', 372, ['Desperate', 'Heroic', 'Tense'], [], ['Chase'], 5, 'Underscore', 'crossfade'],
    ['t12', 'Tender, longing - a quiet moment between two characters', 'Trevor Jones & Randy Edelman', 'The Last of the Mohicans', '07 The Kiss.flac', 171, ['Warm', 'Wistful'], [], ['Rest'], 2, 'Underscore', 'no'],
    ['t13', 'Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)', 'Hildur Gudnadottir', 'Chernobyl', '06 Bridge of Death.flac', 441, ['Dread', 'Eerie'], ['Drowned Abbess'], ['Exploration'], 2, 'Loop bed', 'crossfade'],
    ['t14', 'Alien, unknowable voices - ancient magic, a ghost speaks', 'Johann Johannsson', 'Arrival', '02 Heptapod B.flac', 193, ['Eerie', 'Mysterious', 'Sacred'], ['Drowned Abbess'], ['Revelation', 'Ritual'], 2, 'Underscore', 'crossfade'],
    ['t15', 'Fragile melancholy strings, slow swell - loss, memory, flashback', 'Max Richter', 'The Blue Notebooks', '02 On the Nature of Daylight.flac', 372, ['Melancholy', 'Grief', 'Wistful'], [], ['Revelation', 'Rest'], 1, 'Underscore', 'no'],
    ['t16', 'Playful swashbuckle, fiddles and brass - tavern brawl, rogue antics', 'Klaus Badelt', 'Pirates of the Caribbean', '02 The Medallion Calls.flac', 112, ['Playful', 'Heroic'], [], ['Tavern', 'Combat'], 4, 'Underscore', 'yes'],
    ['t17', 'Rousing sea adventure, big theme - ship sails, triumph at sea', 'Klaus Badelt', 'Pirates of the Caribbean', "15 He's a Pirate.flac", 90, ['Triumphant', 'Playful', 'Heroic'], ['The Company'], ['Travel'], 5, 'Sting', 'no'],
    ['t18', 'Gothic menace, pounding low brass - villain reveal', 'Wojciech Kilar', "Bram Stoker's Dracula", '05 Vampire Hunters.flac', 280, ['Dread', 'Tense', 'Epic'], ['Ashen King'], ['Revelation', 'Combat'], 4, 'Underscore', 'crossfade'],
    ['t19', "Storm and dark romance, swells - villain's tragic backstory", 'Wojciech Kilar', "Bram Stoker's Dracula", '07 The Storm.flac', 212, ['Melancholy', 'Dread', 'Wistful'], ['Ashen King'], ['Revelation'], 3, 'Underscore', 'no'],
    ['t20', 'Spooky folk tale, choir and celeste - entering cursed woods', 'Danny Elfman', 'Sleepy Hollow', '01 Main Titles.flac', 220, ['Eerie', 'Mysterious', 'Playful'], [], ['Exploration', 'Travel'], 3, 'Underscore', 'crossfade'],
    ['t21', "Lullaby, sad and innocent - a child, a memory, a ghost's past (loops well)", 'Javier Navarrete', "Pan's Labyrinth", '01 Long, Long Time Ago.flac', 132, ['Melancholy', 'Wistful', 'Eerie'], ['Drowned Abbess'], ['Revelation'], 1, 'Loop bed', 'yes'],
    ['t22', 'Proud ancient warrior theme, taiko and strings - honour, a duel', 'Joe Hisaishi', 'Princess Mononoke', '01 The Legend of Ashitaka.flac', 160, ['Heroic', 'Epic', 'Melancholy'], [], ['Combat', 'Travel'], 4, 'Underscore', 'no'],
    ['t23', 'Open road, wonder, hopeful horizon (loops well) - travel montage', 'Jeremy Soule', 'The Elder Scrolls V: Skyrim', '1-05 Far Horizons.flac', 243, ['Hopeful', 'Pastoral', 'Wistful'], [], ['Travel'], 2, 'Loop bed', 'yes'],
    ['t24', "Epic choir hero anthem - the Company's big moment", 'Jeremy Soule', 'The Elder Scrolls V: Skyrim', '1-01 Dragonborn.flac', 237, ['Heroic', 'Triumphant', 'Epic'], ['The Company'], ['Travel', 'Combat'], 5, 'Underscore', 'no'],
    ['t25', 'Slow-burn conspiracy, piano and organ, builds to explosion - the plan goes off', 'Ramin Djawadi', 'Game of Thrones, Season 6', '12 Light of the Seven.flac', 590, ['Tense', 'Sacred', 'Dread'], ['Ashen King'], ['Ritual'], 3, 'Underscore', 'no'],
    ['t26', "Ominous song, the villain's calling card (short)", 'Ramin Djawadi', 'Game of Thrones, Season 3', '18 The Rains of Castamere.flac', 147, ['Dread', 'Melancholy'], ['Ashen King'], ['Revelation'], 2, 'Sting', 'no'],
    ['t27', 'Massive brass ostinato, ticking time pressure - race to stop the ritual', 'Hans Zimmer', 'Inception', '05 Mombasa.flac', 294, ['Tense', 'Desperate'], [], ['Chase', 'Ritual'], 5, 'Underscore', 'crossfade'],
    ['t28', 'Slow rising awe, ends huge - revelation, the world turns', 'Hans Zimmer', 'Inception', '12 Time.flac', 275, ['Wistful', 'Epic', 'Hopeful'], [], ['Revelation'], 3, 'Underscore', 'no'],
    ['t29', 'Sombre resolve, leaving home - oaths and farewells', 'Harry Gregson-Williams', 'Kingdom of Heaven', '04 Burning the Past.flac', 192, ['Melancholy', 'Heroic'], ['The Company'], ['Travel', 'Rest'], 2, 'Underscore', 'no'],
    ['t30', 'Siege, desperate, sacred chant - defending the holy place', 'Harry Gregson-Williams', 'Kingdom of Heaven', '18 Wall Breached.flac', 225, ['Desperate', 'Sacred', 'Epic'], [], ['Combat'], 5, 'Underscore', 'no'],
    ['t31', 'Primal pulse, heroic doom (great loop) - boss fight', 'Basil Poledouris', 'Conan the Barbarian', '1-16 Battle of the Mounds.flac', 301, ['Heroic', 'Dread', 'Epic'], [], ['Combat'], 5, 'Loop bed', 'crossfade'],
    ['t32', 'Sombre heroism, dignity in defeat', 'Basil Poledouris', 'Conan the Barbarian', '1-07 Theology - Civilization.flac', 204, ['Melancholy', 'Heroic', 'Grief'], [], ['Rest', 'Revelation'], 2, 'Underscore', 'no'],
    ['t33', 'Celtic longing, pipes - homeland, sacrifice', 'James Horner', 'Braveheart', '06 For the Love of a Princess.flac', 247, ['Wistful', 'Warm', 'Melancholy'], ['Greyhollow'], ['Rest'], 2, 'Underscore', 'no'],
    ['t34', 'Rally before the fight, drums and pipes, defiant', 'James Horner', 'Braveheart', '12 The Battle of Stirling.flac', 404, ['Heroic', 'Tense'], ['The Company'], ['Combat'], 4, 'Underscore', 'crossfade'],
    ['t35', 'Doomed love, sweeping waltz - dark masquerade', 'Wojciech Kilar', "Bram Stoker's Dracula", '13 Love Remembered.flac', 141, ['Melancholy', 'Warm', 'Wistful'], ['Ashen King'], ['Tavern', 'Revelation'], 2, 'Underscore', 'yes'],
    ['t36', 'Desolate awe, choir and organ - death, the road beyond', 'Clint Mansell', 'The Fountain', '06 Death Is the Road to Awe.flac', 506, ['Sacred', 'Epic', 'Grief'], ['Drowned Abbess'], ['Ritual', 'Revelation'], 3, 'Underscore', 'no'],
    ['t37', 'Nervous strings, mystery afoot - investigation, searching a room (loops well)', 'Hans Zimmer', 'Sherlock Holmes', '01 Discombobulate.flac', 149, ['Playful', 'Tense', 'Mysterious'], [], ['Exploration', 'Tavern'], 3, 'Loop bed', 'yes'],
    ['t38', 'Wonder and gentle magic, music box - fey, enchantment', 'Joe Hisaishi', 'Spirited Away', "01 One Summer's Day.flac", 185, ['Wistful', 'Warm', 'Mysterious'], [], ['Exploration', 'Rest'], 1, 'Underscore', 'yes'],
    ['t39', 'Dread rising, choir stabs - monster approaches (sting)', 'Jerry Goldsmith', 'The Mummy', '02 Imhotep.flac', 64, ['Dread', 'Tense'], [], ['Combat'], 4, 'Sting', 'no'],
    ['t40', 'Victory, short and bright - after the fight (sting, cue rest music after)', 'Howard Shore', 'The Return of the King', '2-09 The Field of the Pelennor (finale).flac', 48, ['Triumphant', 'Heroic'], ['The Company'], ['Combat'], 4, 'Sting', 'no'],
    ['t41', "Ancient sorrow, choir - the Abbess's theme (loops well)", 'Howard Shore', 'The Fellowship of the Ring (Complete Recordings)', '2-14 Lothlorien.flac', 273, ['Melancholy', 'Sacred', 'Mysterious'], ['Drowned Abbess'], ['Exploration', 'Revelation'], 2, 'Loop bed', 'yes'],
    ['t42', 'Haunted sea shanty, grey and slow - the drowned bells', 'Hans Zimmer', "Pirates of the Caribbean: At World's End", '01 Hoist the Colours.flac', 91, ['Eerie', 'Melancholy'], ['Drowned Abbess'], ['Exploration'], 2, 'Transition', 'no'],
    // Newly added, not yet titled or tagged: shows the import and tagging flow.
    ['t43', '', 'Bear McCreary', 'God of War', '07 Memories of Mother.flac', 196, [], [], [], 0, '', ''],
    ['t44', '', 'Bear McCreary', 'God of War', '13 Ashes.flac', 222, [], [], [], 0, '', ''],
    ['t45', '', 'Bear McCreary', 'God of War', '21 Valkyries.flac', 248, [], [], [], 0, '', '']
  ];
  function metaTitle(file) { return file.replace(/\.[a-z0-9]+$/i, '').replace(/^[\d-]+\s+/, ''); }
  var tracks = raw.map(function (r, i) {
    return { id: r[0], kind: 'music', title: r[1], metaTitle: metaTitle(r[4]), artist: r[2], album: r[3], file: r[4],
      folder: 'H:\\Audio\\Scores\\' + r[2] + '\\' + r[3], dur: r[5],
      tags: { mood: r[6], motif: r[7], scene: r[8] }, energy: r[9], role: r[10], loop: r[11], notes: '',
      added: i >= 42 ? 'Today' : (i < 20 ? '12 Sep 2026' : '30 Oct 2026'), isNew: i >= 42 };
  });
  // Sample audio profiles: where a track ends and what happens next.
  tracks[12].profile = { start: 0, end: 318, after: 'loop', loopStart: 64, loopXfade: 2, fadeIn: { dur: 0, shape: 50 }, fadeOut: { dur: 0, shape: 50 }, markers: [{ at: 64, label: 'Choir enters' }, { at: 190, label: 'Low swell' }, { at: 318, label: 'Loop back' }] };
  tracks[1].profile = { start: 8, end: 412, after: 'next', loopStart: 8, fadeIn: { dur: 3, shape: 30 }, fadeOut: { dur: 6, shape: 65 }, markers: [{ at: 140, label: 'Builds' }, { at: 300, label: 'Peak' }] };
  // Round 5 (DAT-13): shapes the GM chose; every other track has the shape Lyre suggests from its loudness (core L.levels).
  tracks[5].shape = 'builds';   // t06 The Battle: "long build to full war"
  tracks[14].shape = 'fallsAway'; // t15 On the Nature of Daylight
  // Round 5 (DAT-8): files no longer where Lyre expects them (moved when the drive was reorganised); the move report and
  // Relink list them. Their folder is where they used to be.
  [18, 25, 36].forEach(function (i) { tracks[i].missing = true; });
  // Sample override: in the scene "The abbey ruins" the eerie bed (t13) ends sooner and moves on instead of looping.
  var profiles = { 'sc:crown:s14:sc3': { t13: { start: 0, end: 190, after: 'next', loopStart: 0, fadeIn: { dur: 4, shape: 40 }, fadeOut: { dur: 8, shape: 30 }, markers: [{ at: 64, label: 'Choir enters' }] } } };
  [['b01', 'Rain on stone and slate, steady (loops)', 'rain_stone_steady_loop.wav', ['Melancholy'], ['Exploration']],
   ['b02', 'Crypt: drips, distant water, low room tone', 'crypt_drips_roomtone.wav', ['Eerie', 'Dread'], ['Exploration']],
   ['b03', 'Busy tavern crowd, mugs, laughter', 'tavern_crowd_busy.wav', ['Warm', 'Playful'], ['Tavern']],
   ['b04', 'Night forest, crickets, owl now and then', 'forest_night_crickets.wav', ['Mysterious'], ['Travel', 'Rest']],
   ['b05', 'Wind over open moor, gusting', 'wind_moor_gusts.wav', ['Wistful'], ['Travel']],
   ['b06', 'Far-off abbey bells in fog', 'bells_fog_distant.wav', ['Eerie', 'Sacred'], ['Exploration']],
   ['b07', 'Sea swell against rocks', 'sea_swell_rocks.wav', ['Wistful'], ['Travel']],
   ['b08', 'Campfire crackle, quiet night', 'campfire_crackle.wav', ['Warm'], ['Rest']],
   ['b09', 'Great hall at dinner: cutlery, chatter, fire', 'great_hall_dinner.wav', ['Warm'], ['Tavern']],
   ['b10', 'Opera house foyer, murmur and strings tuning', 'opera_foyer_murmur.wav', ['Tense'], ['Tavern']]
  ].forEach(function (r) {
    tracks.push({ id: r[0], kind: 'amb', title: r[1], metaTitle: '', artist: 'Field recording', album: 'Ambience', file: r[2],
      folder: 'H:\\Audio\\Ambience', dur: 240, tags: { mood: r[3], motif: [], scene: r[4] }, energy: 1, role: 'Loop bed', loop: 'yes', notes: '', added: '12 Sep 2026', isNew: false });
  });

  // Sound effects: kind 'fx'. Pads play these; they can also go straight into a scene.
  [['f01', 'Sword clash (5 variants)', 'sword_clash_01.wav', 1.6, ['Tense'], ['Combat']],
   ['f02', 'Arrow volley', 'arrow_volley_01.wav', 2.4, ['Tense'], ['Combat']],
   ['f03', 'Fireball whoosh and blast', 'fireball_01.wav', 3.2, ['Epic'], ['Combat']],
   ['f04', 'Thunder crack', 'thunder_01.wav', 4, ['Dread'], ['Exploration']],
   ['f05', 'Wolf howl, distant', 'wolf_howl_01.wav', 4.5, ['Eerie'], ['Travel']],
   ['f06', 'Abbey bell, single toll', 'abbey_bell_single.wav', 6, ['Sacred', 'Eerie'], ['Exploration']],
   ['f07', 'Ghost whisper', 'ghost_whisper_01.wav', 3, ['Eerie'], ['Revelation']],
   ['f08', 'Heavy door slams', 'door_slam_heavy.wav', 1.6, ['Tense'], ['Exploration']],
   ['f09', 'Abbess screams', 'abbess_scream.wav', 3.5, ['Dread'], ['Revelation']],
   ['f10', 'Stone door grinds open', 'stone_door_grind.wav', 5, ['Mysterious'], ['Exploration']],
   ['f11', 'Owl post arrives', 'owl_wings_letter.wav', 2, ['Playful'], ['Rest']],
   ['f12', 'Glass breaks', 'glass_break_01.wav', 1.2, ['Tense'], ['Combat']],
   ['f13', 'Heartbeat, slow (loops)', 'heartbeat_slow_loop.wav', 6, ['Dread'], ['Revelation']],
   ['f14', 'Crowd whispers (loops)', 'crowd_whispers_loop.wav', 20, ['Tense'], ['Tavern']]
  ].forEach(function (r) {
    tracks.push({ id: r[0], kind: 'fx', title: r[1], metaTitle: '', artist: 'Sound effect', album: 'Effects', file: r[2],
      folder: 'H:\\Audio\\Effects', dur: r[3], tags: { mood: r[4], motif: [], scene: r[5] }, energy: 2, role: 'Effect', loop: /loop/.test(r[2]) ? 'yes' : 'no', notes: '', added: '12 Sep 2026', isNew: false });
  });

  function M(id, name, items, lane) { return { id: id, name: name, kind: 'manual', lane: lane || 'music', items: items, notes: '' }; }
  function Dyn(id, name, rule, lane) { return { id: id, name: name, kind: 'dynamic', lane: lane || 'music', rule: rule, notes: '' }; }
  // Dynamic rule: every condition must match. {group, match:'any'|'all'|'none', values} plus optional energy [min, max].
  var playlists = [
    M('p-company', 'The Company themes', ['t24', 't08', 't17', 't29', 't34', 't40']),
    M('p-coast', 'Coast road travel', ['t23', 't03', 't10', 't29']),
    M('p-inn', 'Greyhollow inn', ['t05', 't16', 't35', 't37', 't33']),
    M('p-abbess', 'The Abbess', ['t41', 't14', 't15', 't21', 't36']),
    M('p-crypt', 'Crypt ambush', ['t31', 't04', 't06', 't39', 't40']),
    M('p-ashen', 'Ashen King', ['t18', 't19', 't26', 't25']),
    M('p-after', 'Aftermath', ['t07', 't32', 't09']),
    Dyn('p-abbey-eerie', 'Abbey: eerie, low energy', { conds: [{ group: 'motif', match: 'any', values: ['Drowned Abbess'] }, { group: 'mood', match: 'any', values: ['Eerie', 'Dread'] }], energy: [0, 3] }),
    Dyn('p-combat-big', 'Combat: big and loopable', { conds: [{ group: 'scene', match: 'any', values: ['Combat'] }], energy: [4, 5], notRole: 'Sting' }),
    Dyn('p-wistful', 'Wistful with some warmth', { conds: [{ group: 'mood', match: 'all', values: ['Wistful', 'Warm'] }] }),
    M('p-halls', 'Castle corridors', ['t38', 't20', 't37', 't12']),
    Dyn('p-wonder', 'Mystery and wonder', { conds: [{ group: 'mood', match: 'any', values: ['Mysterious', 'Wistful'] }], energy: [0, 3] }),
    M('p-opera', 'Night at the opera', ['t35', 't19', 't15', 't26']),
    M('p-hunt', 'The hunt', ['t18', 't27', 't11', 't39']),
    Dyn('p-gothic', 'Gothic dread', { conds: [{ group: 'mood', match: 'any', values: ['Dread', 'Eerie'] }] }),
    M('x-stings', 'Stings and hits', ['t01', 't39', 't40', 'f04', 'f08', 'f06'], 'fx'),
    M('a-abbey', 'Abbey ambience', ['b01', 'b02', 'b06'], 'amb'),
    M('a-inn', 'Inn and hearth', ['b03', 'b08'], 'amb'),
    M('a-travel', 'Open country', ['b05', 'b04', 'b07'], 'amb'),
    M('a-hall', 'Great hall', ['b09', 'b08'], 'amb'),
    M('a-opera', 'Opera house', ['b10', 'b01'], 'amb')
  ];

  function v(name, n) { var a = []; for (var i = 1; i <= n; i++) a.push(name + '_' + String(i).padStart(2, '0') + '.wav'); return a; }
  // Pad: label, icon, colour (a lane-safe hue name), key, mode, sound {kind:'single'|'variants'|'tag', files|tag, order}, volume 0-100, fade s.
  function P(id, label, icon, color, key, mode, files, order) {
    return { id: id, label: label, icon: icon, color: color, key: key, mode: mode,
      sound: files.length > 1 ? { kind: 'variants', files: files, order: order || 'random' } : { kind: 'single', files: files }, vol: 80, fade: 1.5 };
  }
  var boards = [
    { id: 'combat', name: 'Combat', cols: 4, rows: 3, spare: [], slots: [
      P('sword', 'Sword clash', 'swords', 'steel', '1', 'oneshot', v('sword_clash', 5)), P('arrows', 'Arrow volley', 'arrow', 'steel', '2', 'oneshot', v('arrow_volley', 3)),
      P('shield', 'Shield block', 'shield', 'steel', '3', 'oneshot', ['shield_block_heavy.wav']), P('crit', 'Critical hit', 'star', 'gold', '4', 'retrigger', ['crit_hit_impact.wav']),
      P('fireball', 'Fireball', 'flame', 'ember', 'q', 'oneshot', v('fireball', 3), 'roundrobin'), P('bolt', 'Lightning bolt', 'bolt', 'gold', 'w', 'oneshot', ['lightning_bolt.wav']),
      P('heal', 'Healing word', 'heart', 'moss', 'e', 'oneshot', ['heal_chime_soft.wav']), P('roar', 'Monster roar', 'claw', 'plum', 'r', 'oneshot', v('roar', 6)),
      P('bones', 'Skeletons rattle', 'skull', 'bone', 'a', 'hold', v('bones_rattle', 4)), P('drums', 'War drums', 'drum', 'ember', 's', 'toggle', ['war_drums_loop.wav']),
      P('horn', 'Retreat horn', 'horn', 'gold', 'd', 'oneshot', ['horn_retreat.wav']), null] },
    { id: 'weather', name: 'Weather and places', cols: 4, rows: 2, spare: [Object.assign(P('mugs', 'Mugs clink', 'mug', 'gold', '', 'oneshot', v('mugs_clink', 3)), { aside: true })], slots: [
      P('thunder', 'Thunder crack', 'bolt', 'gold', '1', 'oneshot', v('thunder', 5)), P('wolf', 'Wolf howl', 'moon', 'bone', '2', 'oneshot', v('wolf_howl', 3)),
      P('owl', 'Owl', 'eye', 'moss', '3', 'oneshot', ['owl_hoot.wav']), P('creak', 'Door creak', 'door', 'bone', '4', 'oneshot', v('door_creak', 4), 'roundrobin'),
      P('horse', 'Horse whinny', 'horn', 'bone', 'q', 'oneshot', ['horse_whinny.wav']), P('storm', 'Storm', 'rain', 'sea', 'w', 'toggle', ['storm_heavy_loop.wav']),
      P('wind', 'Wind gust', 'wind', 'sea', 'e', 'oneshot', v('wind_gust', 3)), P('fire', 'Fire flares', 'flame', 'ember', 'r', 'oneshot', ['fire_flare.wav'])] },
    { id: 'abbey', name: 'Drowned Abbey', cols: 4, rows: 3, spare: [], slots: [
      P('bell', 'Abbey bell', 'bell', 'bone', '1', 'oneshot', ['abbey_bell_single.wav']), P('bells', 'All bells ring', 'bell', 'gold', '2', 'toggle', ['abbey_bells_peal_loop.wav']),
      P('whisper', 'Ghost whisper', 'ghost', 'violet', '3', 'oneshot', v('ghost_whisper', 6)), P('organ', 'Organ swell', 'organ', 'violet', '4', 'hold', ['organ_swell_loop.wav']),
      P('choir', 'Drowned choir', 'note', 'sea', 'q', 'toggle', ['drowned_choir_loop.wav']), P('drip', 'Water drips', 'drop', 'sea', 'w', 'oneshot', v('drip', 8)),
      P('chains', 'Chains', 'chain', 'steel', 'e', 'oneshot', v('chains', 3)), P('stonedoor', 'Stone door grinds', 'door', 'bone', 'r', 'oneshot', ['stone_door_grind.wav']),
      P('slam', 'Door slams', 'door', 'plum', 'a', 'retrigger', ['door_slam_heavy.wav']), P('splash', 'Something splashes', 'wave', 'sea', 's', 'oneshot', v('splash', 4)),
      P('scream', 'Abbess screams', 'ghost', 'plum', 'd', 'oneshot', ['abbess_scream.wav']), P('heartab', 'Heartbeat', 'heart', 'plum', 'f', 'hold', ['heartbeat_slow_loop.wav'])] },
    { id: 'spells', name: 'Spellwork', cols: 3, rows: 2, spare: [], slots: [
      P('spark', 'Wand spark', 'star', 'gold', '1', 'oneshot', v('wand_spark', 4)), P('shieldc', 'Shield charm', 'shield', 'sea', '2', 'oneshot', ['shield_charm.wav']),
      P('owlpost', 'Owl post arrives', 'eye', 'bone', '3', 'oneshot', ['owl_wings_letter.wav']), P('pages', 'Pages turn', 'book', 'bone', 'q', 'oneshot', v('pages', 3)),
      P('clock', 'Clock tower', 'bell', 'gold', 'w', 'oneshot', ['clock_tower_chime.wav']), null] },
    { id: 'court', name: 'Elysium court', cols: 3, rows: 2, spare: [], slots: [
      P('heartbeat', 'Heartbeat', 'heart', 'plum', '1', 'hold', ['heartbeat_slow_loop.wav']), P('glass', 'Glass breaks', 'drop', 'steel', '2', 'oneshot', v('glass_break', 3)),
      P('whispers', 'Crowd whispers', 'ghost', 'violet', '3', 'toggle', ['crowd_whispers_loop.wav']), P('door2', 'Heavy door', 'door', 'bone', 'q', 'oneshot', ['heavy_door_close.wav']),
      P('frenzy', 'Frenzy rises', 'claw', 'plum', 'w', 'oneshot', ['frenzy_swell.wav']), P('bellc', 'Church bell', 'bell', 'bone', 'e', 'oneshot', ['church_bell_night.wav'])] }
  ];

  // Scene: music = ordered list of track ids and playlist ids, in any mix (the first item starts the scene, the next
  // follows when it ends); amb = one ambience track or ambience playlist id, or ''; boards = pad board ids (the first
  // shows when the scene starts; the others are a click away).
  function S(id, name, when, music, amb, boards, notes) { return { id: id, name: name, when: when, music: music, amb: amb, boards: [].concat(boards || []).filter(Boolean), notes: notes || '' }; }
  var campaigns = [
    { id: 'crown', name: 'The Sunken Crown', system: 'D&D 5e', theme: 'hearth', blurb: 'A drowned kingdom, a crown under the sea and a company of five.', obsidian: { vault: 'Tabletop', note: 'Campaigns/The Sunken Crown/Overview.md', sessions: 'Campaigns/The Sunken Crown/Sessions' },
      playlists: ['p-company', 'p-ashen', 'p-combat-big', 'x-stings'], boards: ['combat', 'weather'], sessions: [
        { id: 's12', n: 12, name: 'Smugglers of Greyhollow', date: '2026-10-08', status: 'played', playlists: [], boards: [], scenes: [S('x1', 'The harbour at night', '', ['p-inn'], 'a-inn', 'weather')] },
        { id: 's13', n: 13, name: 'The coast road', date: '2026-10-22', status: 'played', playlists: [], boards: [], scenes: [S('x2', 'On the road', '', ['p-coast'], 'a-travel', 'weather')] },
        { id: 's14', n: 14, name: 'The Drowned Abbey', date: '2026-11-05', status: 'next', playlists: ['p-wistful'], boards: ['abbey'], scenes: [
          S('sc1', 'Recap and the coast road', 'As the recap starts', ['p-coast'], 'a-travel', 'weather', 'Keep it short; end on the black sail seen last time.'),
          S('sc2', 'Greyhollow inn', 'The door of the Gull and Lantern opens', ['p-inn', 'p-company'], 'a-inn', 'weather', 'Old Maeve tells the drowned-bells story if asked.'),
          S('sc3', 'The abbey ruins', 'They crest the cliff path', ['t13', 'p-abbey-eerie', 't42', 'p-abbess'], 'a-abbey', ['abbey', 'weather'], 'Rain all the way. Bells ring if anyone touches the altar.'),
          S('sc4', 'Crypt ambush', 'Roll initiative', ['t39', 'p-crypt', 'p-combat-big', 't40'], 'b02', ['combat', 'abbey'], 'Second wave on round 3 or when the wight appears.'),
          S('sc5', 'The Abbess', 'Water rises from the font', ['p-abbess', 'p-ashen'], 'a-abbey', 'abbey', 'She names the Ashen King last.'),
          S('sc6', 'Aftermath', 'They leave the abbey at dawn', ['t07', 't01'], 'b07', 'weather', 'Cliffhanger: a black sail on the horizon.')] },
        { id: 's15', n: 15, name: 'Black sails', date: '', status: 'draft', playlists: [], boards: [], scenes: [S('x3', 'Pursuit at sea', '', ['p-company'], 'a-travel', 'weather')] }] },
    { id: 'sixth', name: 'The Sixth Year', system: 'Fate Core', theme: 'candle', blurb: 'A school of magic, a locked library wing and a year of secrets.', obsidian: { vault: '', note: '', sessions: '' },
      playlists: ['p-halls', 'p-wonder'], boards: ['spells'], sessions: [
        { id: 'w3', n: 3, name: 'The restricted wing', date: '2026-10-29', status: 'played', playlists: [], boards: [], scenes: [S('y1', 'After curfew', '', ['p-halls'], 'a-hall', 'spells')] },
        { id: 'w4', n: 4, name: 'Frost fair', date: '2026-11-12', status: 'next', playlists: [], boards: [], scenes: [
          S('y2', 'Breakfast in the great hall', 'Owls arrive', ['p-halls'], 'a-hall', 'spells'),
          S('y3', 'The frozen lake', 'They walk out onto the ice', ['p-wonder'], 'a-travel', 'spells')] }] },
    { id: 'masks', name: 'Ash and Masks', system: 'Vampire: the Masquerade V5', theme: 'elysium', blurb: 'A gothic chronicle of courts, debts and the hunger.', obsidian: { vault: '', note: '', sessions: '' },
      playlists: ['p-gothic', 'p-opera'], boards: ['court'], sessions: [
        { id: 'v7', n: 7, name: 'Elysium at the opera', date: '2026-11-19', status: 'next', playlists: [], boards: [], scenes: [
          S('z1', 'Arrival at the opera house', 'Carriages in the rain', ['p-opera'], 'a-opera', 'court'),
          S('z2', 'The Prince holds court', 'The doors of the private box close', ['p-gothic'], 'a-opera', 'court'),
          S('z3', 'The hunt', 'Someone runs', ['p-hunt'], '', 'court')] }] }
  ];

  // Discord: the servers and voice channels the bots can see, and the bots themselves (simulated).
  // A bot is in at most one voice channel at a time (one per server is Discord's rule; Lyre uses one).
  // Round 6 (OUT-8): login is the bot's connection to Discord (Settings: online, connecting, offline, error), token the
  // last four characters of its token (the rest is never shown), servers the Discord servers it was invited to.
  var discord = {
    servers: [
      { id: 'g1', name: 'The Gull and Lantern', channels: [
        { id: 'c1', name: 'Table', members: ['Nik', 'Aster', 'Bram', 'Corin', 'Dalia'] },
        { id: 'c2', name: 'Side room', members: [] },
        { id: 'c3', name: 'Whispers', members: [] },
        { id: 'c4', name: 'AFK', members: ['Ezra'] }] },
      { id: 'g2', name: 'Night court', channels: [
        { id: 'c5', name: 'Elysium', members: [] },
        { id: 'c6', name: 'Private audience', members: [] }] }
    ],
    bots: [
      { id: 'b1', name: 'Lyre Table', status: 'connected', server: 'g1', channel: 'c1', muted: false, volume: 85, mix: 'table', login: 'online', token: 'Kq7w', servers: ['g1', 'g2'] },
      { id: 'b2', name: 'Lyre Side', status: 'idle', server: '', channel: '', muted: false, volume: 85, mix: 'table', login: 'online', token: 'p3Zd', servers: ['g1'] }
    ]
  };
  // Round 5 (PLY-13): play order. A playlist's own choice is pl.order; a choice for one place (a scene 'sc:…', a
  // session 'ss:…' or a campaign 'cp:…') lives in orders[placeKey][playlistId] and applies only there.
  playlists.forEach(function (p) { if (p.lane === 'amb') p.order = { shuffle: false, repeat: 'all' }; });
  playlists.filter(function (p) { return p.id === 'p-combat-big'; })[0].order = { shuffle: true, repeat: 'all' };
  var orders = { 'sc:crown:s14:sc3': { 'p-abbey-eerie': { shuffle: true, repeat: 'off' } }, 'ss:crown:s14': { 'p-wistful': { shuffle: true, repeat: 'all' } } };
  // Round 5 (DAT-14): a track's name in one scene (shown there, in Live and in the On air bar; its own name on hover).
  var sceneNames = { 'sc:crown:s14:sc6': { t07: 'Dawn over the abbey' }, 'sc:crown:s14:sc4': { t39: 'The wight rises' } };
  // Round 5 (ORG-12): single tracks kept on hand for a whole campaign or session (Use in… on a track).
  campaigns.forEach(function (c) { c.tracks = []; c.sessions.forEach(function (s) { s.tracks = []; }); });
  campaigns[0].tracks.push('t26');
  // Round 5 (DAT-7): what came across from the Player (Kenku FM) on first start, for the move report.
  var moved = { from: 'Kenku FM 1.5.5', when: '5 Nov 2026, 18:42', playlists: 9, tracks: 212, boards: 4, pads: 37, bookmarks: 6,
    notMoved: [['The play queue and what was playing', 'Lyre starts with nothing playing'], ['Kenku FM\'s window size and position', 'Lyre opens at its own size']] };
  // Round 5 (DAT-15): each track's measured loudness, as Lyre's background job reads it with ffmpeg: "id loudness peak",
  // loudness in LUFS (EBU R128 integrated; for a sound under 3 s its loudest moment) and true peak in dBTP. t02 is the
  // brief's example (-22.6 LUFS, +4.6 dB at Standard), t13 is held back by its peak, t09 meets the +12 dB cap, t06 and
  // t24 are turned down. The three new tracks (t43-t45) are not measured yet.
  var LOUDNESS = 't01 -16.2 -5.1, t02 -22.6 -8.0, t03 -18.1 -6.8, t04 -14.1 -3.1, t05 -22.8 -6.9, t06 -13.1 -0.3, t07 -22.8 -11.6, t08 -14.1 0.6, ' +
    't09 -31.5 -14.2, t10 -17.0 -3.3, t11 -15.4 -1.6, t12 -21.5 -7.4, t13 -26.4 -9.1, t14 -21.4 -7.5, t15 -23.1 -9.1, t16 -17.5 -3.8, ' +
    't17 -15.0 -1.3, t18 -15.8 -0.9, t19 -19.1 -4.9, t20 -20.7 -8.8, t21 -24.3 -12.6, t22 -18.7 -7.0, t23 -22.4 -10.8, t24 -12.4 0.4, ' +
    't25 -20.7 -9.1, t26 -22.7 -10.6, t27 -16.4 -4.4, t28 -20.7 -9.2, t29 -22.7 -10.6, t30 -15.0 -0.7, t31 -14.6 -0.1, t32 -21.0 -6.4, ' +
    't33 -20.6 -5.9, t34 -17.0 -2.2, t35 -20.6 -5.6, t36 -18.6 -4.2, t37 -19.0 -4.4, t38 -22.6 -8.0, t39 -17.0 -2.2, t40 -16.6 -1.8, ' +
    't41 -21.1 -6.4, t42 -21.1 -6.6, b01 -28.7 -15.0, b02 -25.9 -11.2, b03 -25.3 -10.7, b04 -26.0 -11.5, b05 -25.9 -11.0, b06 -25.1 -10.3, ' +
    'b07 -26.0 -11.3, b08 -25.2 -10.6, b09 -25.9 -11.4, b10 -28.6 -16.2, f01 -9.8 -0.2, f02 -11.9 -5.5, f03 -13.0 -6.8, f04 -13.0 -6.5, ' +
    'f05 -11.9 -5.6, f06 -12.9 -6.7, f07 -12.0 -6.0, f08 -13.0 -6.7, f09 -11.9 -5.8, f10 -15.5 -11.4, f11 -8.3 -4.1, f12 -15.4 -11.0, ' +
    'f13 -15.4 -6.6, f14 -8.5 0.0';
  var byId = {}; tracks.forEach(function (t) { byId[t.id] = t; });
  LOUDNESS.split(', ').forEach(function (s) { var a = s.split(' '); byId[a[0]].loud = { lufs: +a[1], peak: +a[2] }; });
  // Round 5 (PLY-15): normalisation is off for the library until the GM turns it on (Library › ⋯ › Normalise volume…).
  // The Ashen King playlist has it on; its calling-card song (t26) is set to Off, and the track's own choice wins.
  var normalise = { on: false, target: 'standard' };
  playlists.filter(function (p) { return p.id === 'p-ashen'; })[0].norm = 'on';
  byId.t26.norm = 'off';
  return { normalise: normalise, discord: discord, orders: orders, sceneNames: sceneNames, moved: moved, tagGroups: tagGroups, tagValues: tagValues, tracks: tracks, playlists: playlists, boards: boards, campaigns: campaigns,
    folders: ['H:\\Audio\\Scores', 'H:\\Audio\\Ambience', 'H:\\Audio\\Effects'], defaultTheme: 'candle', profiles: profiles };
})();
