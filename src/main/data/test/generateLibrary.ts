/**
 * Builds a large, realistic library for the performance tests: tracks with
 * file names, notes, tags and markers, and playlists holding them.
 * Deterministic (fixed seed), so runs are comparable.
 */
import type { Library } from "../library";
import { createTracks } from "../repo/tracks";
import { addMarker } from "../repo/markers";
import { createTag, listTagGroups, tagTracks } from "../repo/tags";
import { addTracksToPlaylist, createPlaylist } from "../repo/playlists";

const WORDS = (
  "dark forest tavern battle storm harbour castle crypt village market chase ambush ritual dragon " +
  "night dawn rain wind fire ice shadow silver golden ancient lost hidden sacred cursed royal " +
  "whisper echo lament march waltz hymn requiem theme overture finale prelude interlude nocturne " +
  "bells drums strings choir horns harp lute flute organ piano ember frost thunder mist river"
).split(" ");

const COMPOSERS = ["Marcin Przybyłowicz", "Jeremy Soule", "Inon Zur", "Hans Zimmer", "Yoko Shimomura", "Austin Wintory"];

/** Small, fast, seeded random numbers (mulberry32). */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateLibrary(library: Library, options: { tracks: number; playlists: number; seed?: number }) {
  const { store } = library;
  const rnd = random(options.seed ?? 42);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const trackIds: string[] = [];
  store.changeWithoutHistory(() => {
    const groups = listTagGroups(store);
    const tagIds: string[] = [];
    for (const group of groups) {
      for (let i = 0; i < 12; i++) {
        tagIds.push(createTag(store, { groupId: group.id, name: `${capital(words(1))} ${group.name} ${i}` }).id);
      }
    }
    const batch = 1000;
    for (let start = 0; start < options.tracks; start += batch) {
      const inputs = Array.from({ length: Math.min(batch, options.tracks - start) }, (_, i) => {
        const n = start + i;
        const title = capital(words(2 + Math.floor(rnd() * 3)));
        return {
          title,
          file: {
            path: `H:\\Audio\\Soundtracks\\${pick(COMPOSERS)}\\${capital(words(2))}\\${n} ${title}.flac`,
            size: 1_000_000 + Math.floor(rnd() * 9_000_000),
            mtimeMs: 1_700_000_000_000 + n,
          },
          notes: rnd() < 0.3 ? `Use for the ${words(3)}` : "",
          sourceComposer: pick(COMPOSERS),
          energy: 1 + Math.floor(rnd() * 5),
        };
      });
      for (const track of createTracks(store, inputs)) {
        trackIds.push(track.id);
        tagTracks(store, [track.id], [pick(tagIds), pick(tagIds), pick(tagIds)].filter((id, i, all) => all.indexOf(id) === i));
        if (rnd() < 0.2) addMarker(store, track.id, { timeMs: Math.floor(rnd() * 200_000), label: `${words(1)} swell` });
      }
    }
    const perPlaylist = Math.max(1, Math.floor(options.tracks / options.playlists) * 2);
    for (let p = 0; p < options.playlists; p++) {
      const playlist = createPlaylist(store, { title: capital(words(2)), background: "tavern" });
      const members = Array.from({ length: perPlaylist }, () => pick(trackIds));
      addTracksToPlaylist(store, playlist.id, [...new Set(members)]);
    }
  });
  return { trackIds };
}
