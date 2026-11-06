/**
 * The prototype's sample data (design/prototype/src/data.js), typed, for the in-memory LyreApi (fake.ts), its
 * tests and the e2e demo. The rows below are copied from data.js unchanged; the functions after them turn them
 * into the API's shapes (seconds to milliseconds, display names to the domain's values).
 *
 * One difference from the prototype: a pad's sound is a list of library tracks (as the database stores it), while
 * the prototype names files. A pad file whose name (without its _01 number) is an FX track's file plays that
 * track; the 60 pad files with no such track are left out, so the Library keeps its 69 tracks.
 */
import { DEFAULT_LIBRARY_NORMALISE, type AudioProfileInput, type LibraryNormalise, type LoopAdvice, type NormaliseChoice, type PadMode, type PlayOrder, type PlayOrderOverrides, type PlaylistRule, type ProfileOverrides, type TrackLoudness, type TrackRole, type TrackShape } from "../domain";
import { fileAddress } from "./media";
import type { CampaignInfo, CampaignTheme, FolderRoot, LibraryTrack, MoveReport, Pad, PadBoard, PadColor, PlaylistInfo, SessionStatus, TagGroup } from "./api";
import { NOT_BROUGHT_ACROSS } from "./transfer";

export interface SeedData {
  tagGroups: TagGroup[];
  tracks: LibraryTrack[];
  playlists: PlaylistInfo[];
  boards: PadBoard[];
  campaigns: CampaignInfo[];
  folders: FolderRoot[];
  overrides: ProfileOverrides;
  /** Round 5 (PLY-13): play order chosen in one place, by place key then playlist id. */
  playOrders: PlayOrderOverrides;
  /** Round 5 (DAT-8): tracks whose files are not where the library expects them (the move report, Find missing files). */
  missing: string[];
  /** Round 5 (DAT-7): what came across from Kenku FM on the first start; its missing files are worked out. */
  moved: Omit<MoveReport, "missing">;
  /** Round 5 (PLY-15): the library's Normalise volume setting (off, Standard). */
  normalise: LibraryNormalise;
}

/* ---------- rows copied from data.js ---------- */

const TAG_GROUPS: [string, string][] = [
  ["mood", "Mood"],
  ["motif", "Leitmotif"],
  ["scene", "Scene type"],
];
const TAG_VALUES: Record<string, string[]> = {
  mood: ['Heroic', 'Triumphant', 'Warm', 'Pastoral', 'Playful', 'Hopeful', 'Epic', 'Sacred', 'Wistful', 'Mysterious', 'Melancholy', 'Desperate', 'Tense', 'Grief', 'Eerie', 'Dread'],
  motif: ['The Company', 'Drowned Abbess', 'Ashen King', 'Greyhollow'],
  scene: ['Combat', 'Exploration', 'Tavern', 'Travel', 'Revelation', 'Chase', 'Ritual', 'Rest']
};

type MusicRow = [string, string, string, string, string, number, string[], string[], string[], number, string, string];
const MUSIC: MusicRow[] = [
  // [id, your title (empty = none yet), composer, album, file, seconds, moods, motifs, scenes, energy, role, loop]
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

type ProtoProfile = {
  start: number;
  end: number;
  after: "loop" | "next" | "stop";
  loopStart: number;
  loopXfade?: number;
  fadeIn: { dur: number; shape: number };
  fadeOut: { dur: number; shape: number };
  markers: { at: number; label: string }[];
};
/** Sample audio profiles (data.js: tracks[12] is t13, tracks[1] is t02). */
const OWN_PROFILES: Record<string, ProtoProfile> = {
  t13: { start: 0, end: 318, after: 'loop', loopStart: 64, loopXfade: 2, fadeIn: { dur: 0, shape: 50 }, fadeOut: { dur: 0, shape: 50 }, markers: [{ at: 64, label: 'Choir enters' }, { at: 190, label: 'Low swell' }, { at: 318, label: 'Loop back' }] },
  t02: { start: 8, end: 412, after: 'next', loopStart: 8, fadeIn: { dur: 3, shape: 30 }, fadeOut: { dur: 6, shape: 65 }, markers: [{ at: 140, label: 'Builds' }, { at: 300, label: 'Peak' }] },
};
  // Sample override: in the scene "The abbey ruins" the eerie bed (t13) ends sooner and moves on instead of looping.
const OVERRIDES: Record<string, Record<string, ProtoProfile>> = { 'sc:crown:s14:sc3': { t13: { start: 0, end: 190, after: 'next', loopStart: 0, fadeIn: { dur: 4, shape: 40 }, fadeOut: { dur: 8, shape: 30 }, markers: [{ at: 64, label: 'Choir enters' }] } } };

/* Round 5 samples (data.js after the boards and campaigns). */
/** DAT-13: shapes the game master chose (data.js tracks[5] is t06, tracks[14] is t15). */
const SHAPES: Record<string, TrackShape> = { t06: 'builds', t15: 'fallsAway' };
/** DAT-8: files no longer where Lyre expects them (data.js tracks[18], [25], [36]). */
const MISSING = ['t19', 't26', 't37'];
/** PLY-13: playlists' own orders (every ambience playlist repeats all; Combat: big and loopable is shuffled), and per place. */
const OWN_ORDERS: Record<string, PlayOrder> = { 'p-combat-big': { shuffle: true, repeat: 'all' } };
const ORDERS: PlayOrderOverrides = { 'sc:crown:s14:sc3': { 'p-abbey-eerie': { shuffle: true, repeat: 'off' } }, 'ss:crown:s14': { 'p-wistful': { shuffle: true, repeat: 'all' } } };
/** DAT-14: a track's name in one scene. */
const SCENE_NAMES: Record<string, Record<string, string>> = { 'sc:crown:s14:sc6': { t07: 'Dawn over the abbey' }, 'sc:crown:s14:sc4': { t39: 'The wight rises' } };
/** DAT-15: loudness measured from each sample track's file, "id LUFS true-peak" (data.js LOUDNESS, copied as it is). */
const LOUDNESS = 't01 -16.2 -5.1, t02 -22.6 -8.0, t03 -18.1 -6.8, t04 -14.1 -3.1, t05 -22.8 -6.9, t06 -13.1 -0.3, t07 -22.8 -11.6, t08 -14.1 0.6, ' +
  't09 -31.5 -14.2, t10 -17.0 -3.3, t11 -15.4 -1.6, t12 -21.5 -7.4, t13 -26.4 -9.1, t14 -21.4 -7.5, t15 -23.1 -9.1, t16 -17.5 -3.8, ' +
  't17 -15.0 -1.3, t18 -15.8 -0.9, t19 -19.1 -4.9, t20 -20.7 -8.8, t21 -24.3 -12.6, t22 -18.7 -7.0, t23 -22.4 -10.8, t24 -12.4 0.4, ' +
  't25 -20.7 -9.1, t26 -22.7 -10.6, t27 -16.4 -4.4, t28 -20.7 -9.2, t29 -22.7 -10.6, t30 -15.0 -0.7, t31 -14.6 -0.1, t32 -21.0 -6.4, ' +
  't33 -20.6 -5.9, t34 -17.0 -2.2, t35 -20.6 -5.6, t36 -18.6 -4.2, t37 -19.0 -4.4, t38 -22.6 -8.0, t39 -17.0 -2.2, t40 -16.6 -1.8, ' +
  't41 -21.1 -6.4, t42 -21.1 -6.6, b01 -28.7 -15.0, b02 -25.9 -11.2, b03 -25.3 -10.7, b04 -26.0 -11.5, b05 -25.9 -11.0, b06 -25.1 -10.3, ' +
  'b07 -26.0 -11.3, b08 -25.2 -10.6, b09 -25.9 -11.4, b10 -28.6 -16.2, f01 -9.8 -0.2, f02 -11.9 -5.5, f03 -13.0 -6.8, f04 -13.0 -6.5, ' +
  'f05 -11.9 -5.6, f06 -12.9 -6.7, f07 -12.0 -6.0, f08 -13.0 -6.7, f09 -11.9 -5.8, f10 -15.5 -11.4, f11 -8.3 -4.1, f12 -15.4 -11.0, ' +
  'f13 -15.4 -6.6, f14 -8.5 0.0';
const MEASURED: Record<string, TrackLoudness> = Object.fromEntries(
  LOUDNESS.split(", ").map((entry) => {
    const [id, lufs, peak] = entry.split(" ");
    return [id, { lufs: Number(lufs), truePeakDb: Number(peak) }];
  }),
);
/** PLY-15: Ashen King normalises its tracks; its calling-card song is set to Off (the track's choice wins). */
const NORMALISE_PLAYLISTS: Record<string, NormaliseChoice> = { 'p-ashen': 'on' };
const NORMALISE_TRACKS: Record<string, NormaliseChoice> = { t26: 'off' };
/** ORG-12: single tracks kept on hand (data.js: campaigns[0].tracks). */
const ON_HAND: Record<string, string[]> = { crown: ['t26'] };
/** SFX-11: spare pads put there by hand (data.js: Mugs clink, aside). */
const ASIDE = new Set(['mugs']);

type AmbRow = [string, string, string, string[], string[]];
const AMBIENCE: AmbRow[] = [
  ['b01', 'Rain on stone and slate, steady (loops)', 'rain_stone_steady_loop.wav', ['Melancholy'], ['Exploration']],
  ['b02', 'Crypt: drips, distant water, low room tone', 'crypt_drips_roomtone.wav', ['Eerie', 'Dread'], ['Exploration']],
  ['b03', 'Busy tavern crowd, mugs, laughter', 'tavern_crowd_busy.wav', ['Warm', 'Playful'], ['Tavern']],
  ['b04', 'Night forest, crickets, owl now and then', 'forest_night_crickets.wav', ['Mysterious'], ['Travel', 'Rest']],
  ['b05', 'Wind over open moor, gusting', 'wind_moor_gusts.wav', ['Wistful'], ['Travel']],
  ['b06', 'Far-off abbey bells in fog', 'bells_fog_distant.wav', ['Eerie', 'Sacred'], ['Exploration']],
  ['b07', 'Sea swell against rocks', 'sea_swell_rocks.wav', ['Wistful'], ['Travel']],
  ['b08', 'Campfire crackle, quiet night', 'campfire_crackle.wav', ['Warm'], ['Rest']],
  ['b09', 'Great hall at dinner: cutlery, chatter, fire', 'great_hall_dinner.wav', ['Warm'], ['Tavern']],
  ['b10', 'Opera house foyer, murmur and strings tuning', 'opera_foyer_murmur.wav', ['Tense'], ['Tavern']],
];

type FxRow = [string, string, string, number, string[], string[]];
const EFFECTS: FxRow[] = [
  ['f01', 'Sword clash (5 variants)', 'sword_clash_01.wav', 1.6, ['Tense'], ['Combat']],
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
  ['f14', 'Crowd whispers (loops)', 'crowd_whispers_loop.wav', 20, ['Tense'], ['Tavern']],
];

type ProtoRule = { conds: { group: string; match: "any" | "all" | "none"; values: string[] }[]; energy?: [number, number]; notRole?: string };
type ProtoPlaylist = { id: string; name: string; kind: "manual"; lane: "music" | "amb" | "fx"; items: string[] } | { id: string; name: string; kind: "dynamic"; lane: "music"; rule: ProtoRule };
const M = (id: string, name: string, items: string[], lane: "music" | "amb" | "fx" = "music"): ProtoPlaylist => ({ id, name, kind: "manual", lane, items });
const Dyn = (id: string, name: string, rule: ProtoRule): ProtoPlaylist => ({ id, name, kind: "dynamic", lane: "music", rule });
const PLAYLISTS: ProtoPlaylist[] = [
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
  M('a-opera', 'Opera house', ['b10', 'b01'], 'amb'),
];

type ProtoPad = { id: string; label: string; icon: string; color: string; key: string; mode: string; files: string[]; order: "random" | "roundrobin" };
/** File names name_01.wav to name_0n.wav, as data.js v() makes them. */
const v = (name: string, n: number) => Array.from({ length: n }, (_, i) => `${name}_${String(i + 1).padStart(2, "0")}.wav`);
const P = (id: string, label: string, icon: string, color: string, key: string, mode: string, files: string[], order: "random" | "roundrobin" = "random"): ProtoPad => ({ id, label, icon, color, key, mode, files, order });
type ProtoBoard = { id: string; name: string; cols: number; rows: number; spare: ProtoPad[]; slots: (ProtoPad | null)[] };
const BOARDS: ProtoBoard[] = [
  { id: 'combat', name: 'Combat', cols: 4, rows: 3, spare: [], slots: [
    P('sword', 'Sword clash', 'swords', 'steel', '1', 'oneshot', v('sword_clash', 5)), P('arrows', 'Arrow volley', 'arrow', 'steel', '2', 'oneshot', v('arrow_volley', 3)),
    P('shield', 'Shield block', 'shield', 'steel', '3', 'oneshot', ['shield_block_heavy.wav']), P('crit', 'Critical hit', 'star', 'gold', '4', 'retrigger', ['crit_hit_impact.wav']),
    P('fireball', 'Fireball', 'flame', 'ember', 'q', 'oneshot', v('fireball', 3), 'roundrobin'), P('bolt', 'Lightning bolt', 'bolt', 'gold', 'w', 'oneshot', ['lightning_bolt.wav']),
    P('heal', 'Healing word', 'heart', 'moss', 'e', 'oneshot', ['heal_chime_soft.wav']), P('roar', 'Monster roar', 'claw', 'plum', 'r', 'oneshot', v('roar', 6)),
    P('bones', 'Skeletons rattle', 'skull', 'bone', 'a', 'hold', v('bones_rattle', 4)), P('drums', 'War drums', 'drum', 'ember', 's', 'toggle', ['war_drums_loop.wav']),
    P('horn', 'Retreat horn', 'horn', 'gold', 'd', 'oneshot', ['horn_retreat.wav']), null] },
  { id: 'weather', name: 'Weather and places', cols: 4, rows: 2, spare: [P('mugs', 'Mugs clink', 'mug', 'gold', '', 'oneshot', v('mugs_clink', 3))], slots: [
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

type ProtoScene = { id: string; name: string; when: string; music: string[]; amb: string; boards: string[]; notes: string };
const S = (id: string, name: string, when: string, music: string[], amb: string, boards: string | string[], notes = ""): ProtoScene => ({ id, name, when, music, amb, boards: ([] as string[]).concat(boards || []).filter(Boolean), notes });
type ProtoSession = { id: string; n: number; name: string; date: string; status: string; playlists: string[]; boards: string[]; scenes: ProtoScene[] };
type ProtoCampaign = { id: string; name: string; system: string; theme: string; blurb: string; obsidian: { vault: string; note: string; sessions: string }; playlists: string[]; boards: string[]; sessions: ProtoSession[] };
const CAMPAIGNS: ProtoCampaign[] = [
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

const FOLDERS = ["H:\\Audio\\Scores", "H:\\Audio\\Ambience", "H:\\Audio\\Effects"];

/* ---------- conversion to the API's shapes ---------- */

const ROLE: Record<string, TrackRole> = { "Loop bed": "loop_bed", Underscore: "underscore", Sting: "sting", Transition: "transition", Effect: "effect" };
const SEP_12 = Date.UTC(2026, 8, 12, 12);
const OCT_30 = Date.UTC(2026, 9, 30, 12);
const secs = (s: number) => Math.round(s * 1000);
/** The title in a file's tags, as data.js makes it from the file name. */
const metaTitle = (file: string) => file.replace(/\.[a-z0-9]+$/i, "").replace(/^[\d-]+\s+/, "");

function profile(p: ProtoProfile): AudioProfileInput {
  return {
    startMs: secs(p.start),
    endMs: secs(p.end),
    after: p.after,
    loopStartMs: secs(p.loopStart),
    loopCrossfadeMs: secs(p.loopXfade ?? 0),
    fadeIn: { ms: secs(p.fadeIn.dur), shape: p.fadeIn.shape },
    fadeOut: { ms: secs(p.fadeOut.dur), shape: p.fadeOut.shape },
    markers: p.markers.map((m) => ({ atMs: secs(m.at), label: m.label })),
  };
}

function tracks(now: number): LibraryTrack[] {
  const music = MUSIC.map((r, i): Omit<LibraryTrack, "url" | "sizeBytes" | "normalise" | "loudness"> => ({
    id: r[0],
    kind: "music",
    title: r[1],
    metaTitle: metaTitle(r[4]),
    fileName: r[4],
    durationMs: secs(r[5]),
    role: ROLE[r[10]] ?? null,
    loop: (r[11] || null) as LoopAdvice | null,
    energy: r[9] || null,
    tags: { mood: [...r[6]], motif: [...r[7]], scene: [...r[8]] },
    profile: OWN_PROFILES[r[0]] ? profile(OWN_PROFILES[r[0]]) : null,
    shape: SHAPES[r[0]] ?? null,
    // The prototype makes its suggestions up from a made-up loudness (core.js L.levels); here they come from peaks.
    suggestedShape: null,
    artist: r[2],
    album: r[3],
    folder: `H:\\Audio\\Scores\\${r[2]}\\${r[3]}`,
    notes: "",
    // data.js: the first 20 were added on 12 Sep, the next on 30 Oct, the last three today (and are New).
    addedAt: i >= 42 ? now - (MUSIC.length - i) : i < 20 ? SEP_12 : OCT_30,
    isNew: i >= 42,
  }));
  const ambience = AMBIENCE.map((r): Omit<LibraryTrack, "url" | "sizeBytes" | "normalise" | "loudness"> => ({
    id: r[0], kind: "amb", title: r[1], metaTitle: "", fileName: r[2], durationMs: secs(240), role: "loop_bed", loop: "yes", energy: 1,
    tags: { mood: [...r[3]], motif: [], scene: [...r[4]] }, profile: null, shape: null, suggestedShape: null,
    artist: "Field recording", album: "Ambience", folder: "H:\\Audio\\Ambience", notes: "", addedAt: SEP_12, isNew: false,
  }));
  const effects = EFFECTS.map((r): Omit<LibraryTrack, "url" | "sizeBytes" | "normalise" | "loudness"> => ({
    id: r[0], kind: "fx", title: r[1], metaTitle: "", fileName: r[2], durationMs: secs(r[3]), role: "effect", loop: /loop/.test(r[2]) ? "yes" : "no", energy: 2,
    tags: { mood: [...r[4]], motif: [], scene: [...r[5]] }, profile: null, shape: null, suggestedShape: null,
    artist: "Sound effect", album: "Effects", folder: "H:\\Audio\\Effects", notes: "", addedAt: SEP_12, isNew: false,
  }));
  // The prototype has no files; each sample track gets the address its file would have.
  return [...music, ...ambience, ...effects].map(
    (t): LibraryTrack => ({ ...t, normalise: NORMALISE_TRACKS[t.id] ?? null, loudness: MEASURED[t.id] ? { ...MEASURED[t.id] } : null, url: fileAddress(`${t.folder}\\${t.fileName}`), sizeBytes: null }),
  );
}

function playlists(): PlaylistInfo[] {
  return PLAYLISTS.map((p): PlaylistInfo => {
    // data.js: every ambience playlist repeats all; a few have an order of their own.
    const order = OWN_ORDERS[p.id] ? { ...OWN_ORDERS[p.id] } : p.lane === "amb" ? { shuffle: false, repeat: "all" as const } : null;
    const normalise = NORMALISE_PLAYLISTS[p.id] ?? null;
    if (p.kind === "manual") return { id: p.id, name: p.name, lane: p.lane, order, normalise, kind: "manual", trackIds: [...p.items], notes: "" };
    const rule: PlaylistRule = { conds: p.rule.conds.map((c) => ({ ...c, values: [...c.values] })) };
    if (p.rule.energy) rule.energy = [p.rule.energy[0], p.rule.energy[1]];
    if (p.rule.notRole === "Sting") rule.leaveOutStings = true;
    return { id: p.id, name: p.name, lane: p.lane, order, normalise, kind: "dynamic", rule, notes: "" };
  });
}

function boards(): PadBoard[] {
  // A pad file plays the FX track whose file has the same name once the variant number is left off.
  const stem = (file: string) => file.replace(/(_\d+)?\.wav$/i, "");
  const fxByStem = new Map(EFFECTS.map((r) => [stem(r[2]), r[0]]));
  const pad = (p: ProtoPad): Pad => ({
    id: p.id,
    label: p.label,
    icon: p.icon,
    color: p.color as PadColor,
    key: p.key,
    mode: p.mode as PadMode,
    sound: {
      kind: p.files.length > 1 ? "variants" : "single",
      trackIds: [...new Set(p.files.map((f) => fxByStem.get(stem(f))).filter((id): id is string => !!id))],
      order: p.order === "roundrobin" ? "in_turn" : "random",
      tag: null,
    },
    volume: 0.8,
    fadeOutMs: 1500,
    aside: ASIDE.has(p.id),
  });
  return BOARDS.map((b) => ({ id: b.id, name: b.name, cols: b.cols, rows: b.rows, slots: b.slots.map((p) => (p ? pad(p) : null)), spare: b.spare.map(pad) }));
}

function campaigns(soundRef: (id: string) => { kind: "track" | "playlist"; id: string }): CampaignInfo[] {
  return CAMPAIGNS.map((c) => ({
    id: c.id,
    name: c.name,
    system: c.system,
    theme: c.theme as CampaignTheme,
    description: c.blurb,
    notes: "",
    obsidian: { vault: c.obsidian.vault, note: c.obsidian.note, sessionsFolder: c.obsidian.sessions },
    playlistIds: [...c.playlists],
    boardIds: [...c.boards],
    trackIds: [...(ON_HAND[c.id] ?? [])],
    sessions: c.sessions.map((s) => ({
      id: s.id,
      campaignId: c.id,
      number: s.n,
      name: s.name,
      date: s.date || null,
      status: s.status as SessionStatus,
      noteLink: "",
      playlistIds: [...s.playlists],
      boardIds: [...s.boards],
      trackIds: [] as string[],
      scenes: s.scenes.map((sc) => ({
        id: sc.id,
        name: sc.name,
        startsWhen: sc.when,
        notes: sc.notes,
        noteLink: "",
        music: sc.music.map(soundRef),
        ambience: sc.amb ? soundRef(sc.amb) : null,
        boardIds: [...sc.boards],
        trackNames: { ...(SCENE_NAMES[`sc:${c.id}:${s.id}:${sc.id}`] ?? {}) },
      })),
    })),
  }));
}

/** A fresh copy of the prototype's sample data. `now` dates the three tracks data.js added "Today". */
export function prototypeSeed(now: number = Date.UTC(2026, 10, 5, 12)): SeedData {
  const allTracks = tracks(now);
  const trackIds = new Set(allTracks.map((t) => t.id));
  const overrides: ProfileOverrides = {};
  for (const [key, byTrack] of Object.entries(OVERRIDES)) {
    overrides[key] = {};
    for (const [trackId, p] of Object.entries(byTrack)) overrides[key][trackId] = profile(p);
  }
  return {
    tagGroups: TAG_GROUPS.map(([id, name]) => ({ id, name, values: [...TAG_VALUES[id]] })),
    tracks: allTracks,
    playlists: playlists(),
    boards: boards(),
    campaigns: campaigns((id) => (trackIds.has(id) ? { kind: "track", id } : { kind: "playlist", id })),
    folders: FOLDERS.map((path) => ({ path, watched: false })),
    overrides,
    playOrders: JSON.parse(JSON.stringify(ORDERS)) as PlayOrderOverrides,
    missing: [...MISSING],
    normalise: { ...DEFAULT_LIBRARY_NORMALISE },
    // data.js `moved`: Kenku FM 1.5.5 on 5 Nov 2026 at 18:42.
    moved: {
      from: "Kenku FM 1.5.5",
      at: Date.UTC(2026, 10, 5, 18, 42),
      copied: [
        { what: "Playlists", count: 9, nowIn: "Playlists (Manual)", route: "#/playlists" },
        { what: "Tracks", count: 212, nowIn: "Library", route: "#/library" },
        { what: "Soundboards", count: 4, nowIn: "Pad boards", route: "#/boards" },
        { what: "Sounds", count: 37, nowIn: "Pads on those boards", route: "#/boards" },
        { what: "Bookmarks", count: 6, nowIn: "Website tabs", route: null },
      ],
      notBrought: NOT_BROUGHT_ACROSS.map((x) => ({ ...x })),
    },
  };
}
