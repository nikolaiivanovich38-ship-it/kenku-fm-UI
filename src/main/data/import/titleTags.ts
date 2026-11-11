/**
 * DAT-4 (Should): suggestions from the game master's descriptive titles.
 *
 * Titles such as "Melancholy tense - harbour at night (loops well)" or
 * "Heroic sting - short rise, don't loop" already say how a track feels and
 * behaves. Lyre reads them against the tag vocabulary (names and synonyms,
 * whole words; a name of six letters or more also matches with -ly or -ness,
 * "triumphantly"; a word right after "not", "no", "never" or "without" does
 * not count) and against a few phrases for loop advice and role. Mood and
 * genre tags read from the file (DAT-5) can be passed as hints.
 *
 * Only suggestions: nothing is changed until the game master accepts, and
 * `applyTitleSuggestions` applies what was accepted as one undo step. Tags the
 * track has, and loop advice or a role already chosen, are never suggested.
 */
import type { LoopAdvice, TrackRole } from "../../../common/domain";
import { ValidationError } from "../errors";
import type { Store } from "../store";
import { getTrack, updateTrack } from "../repo/tracks";
import { listTagGroups, listTags, tagTracks, tagsOfTrack } from "../repo/tags";
import { plural } from "../repo/common";
import type { TrackPatch } from "../types";
import * as v from "../validate";

export type SuggestedTag = { tagId: string; name: string; groupName: string; /** The name or synonym found. */ matched: string };

export type TitleSuggestion = {
  trackId: string;
  tags: SuggestedTag[];
  /** Loop advice the title gives, when the track has none yet. */
  loopable: LoopAdvice | null;
  /** The role the title names, when the track has none yet. */
  role: TrackRole | null;
};

const NEGATIONS = new Set(["not", "no", "never", "without", "non"]);
const SUFFIXES = ["ly", "ness"];
const LETTERS = new RegExp("[\\p{L}\\p{N}']+", "gu");
const MARKS = new RegExp("\\p{M}", "gu");

/** Lower-case words without accents. */
function words(text: string): string[] {
  return (text.normalize("NFD").replace(MARKS, "").toLowerCase().match(LETTERS) ?? []).map((w) => w.replace(/^'+|'+$/g, ""));
}

function wordMatches(word: string, term: string, last: boolean): boolean {
  if (word === term) return true;
  return last && term.length >= 6 && SUFFIXES.some((suffix) => word === term + suffix);
}

/** Whether `term` (its words) appears in `text` (its words), not right after a negation. */
function appears(text: string[], term: string[]): boolean {
  for (let i = 0; i + term.length <= text.length; i++) {
    if (term.every((t, k) => wordMatches(text[i + k], t, k === term.length - 1)) && !NEGATIONS.has(text[i - 1] ?? "")) return true;
  }
  return false;
}

/** Loop advice in a title: "don't loop" before "crossfade the loop" before "loops well". */
export function loopAdviceIn(title: string): LoopAdvice | null {
  const text = title.toLowerCase().replace(/[’`]/g, "'");
  if (/\b(don'?t|do not|does not|doesn'?t|won'?t|never|no)[ -]loop|\bnot loopable\b|\bone[- ]shot\b/.test(text)) return "no";
  if (/\bcross-?fade\w*\b.*\bloop|\bloop\w*\b.*\bcross-?fade/.test(text)) return "crossfade";
  if (/\bloops? (well|clean(ly)?|fine|seamless(ly)?|nicely)\b|\bloopable\b|\bseamless loop\b|\(loop\)/.test(text)) return "yes";
  return null;
}

/** A role a title names. */
export function roleIn(title: string): TrackRole | null {
  const text = title.toLowerCase();
  if (/\bstings?\b/.test(text)) return "sting";
  if (/\bunderscore\b/.test(text)) return "underscore";
  if (/\bloop bed\b|\bbed\b/.test(text)) return "loop_bed";
  if (/\btransition\b/.test(text)) return "transition";
  return null;
}

/**
 * Suggestions for each track, in the order given (tracks that no longer exist
 * are left out). `hints`: extra words per track id, such as the file's mood and
 * genre tags (ImportResult.tagHints).
 */
export function suggestFromTitles(store: Store, trackIds: string[], options: { hints?: Record<string, string[]> } = {}): TitleSuggestion[] {
  const ids = v.ids("trackIds", trackIds);
  const groupNames = new Map(listTagGroups(store).map((group) => [group.id, group.name]));
  const vocabulary = listTags(store).flatMap((tag) =>
    [tag.name, ...tag.synonyms].map((term) => ({ tag, term, words: words(term) })).filter((entry) => entry.words.length > 0),
  );
  const suggestions: TitleSuggestion[] = [];
  for (const id of ids) {
    const track = getTrack(store, id);
    if (!track) continue;
    const has = new Set(tagsOfTrack(store, id).map((tag) => tag.id));
    const texts = [track.title, ...(options.hints?.[id] ?? [])].map(words);
    const tags: SuggestedTag[] = [];
    for (const entry of vocabulary) {
      if (has.has(entry.tag.id) || tags.some((s) => s.tagId === entry.tag.id)) continue;
      if (texts.some((text) => appears(text, entry.words))) {
        tags.push({ tagId: entry.tag.id, name: entry.tag.name, groupName: groupNames.get(entry.tag.groupId) ?? "", matched: entry.term });
      }
    }
    suggestions.push({
      trackId: id,
      tags,
      loopable: track.loopable === null ? loopAdviceIn(track.title) : null,
      role: track.role === null ? roleIn(track.title) : null,
    });
  }
  return suggestions;
}

export type AcceptedSuggestion = { trackId: string; tagIds?: string[]; loopable?: LoopAdvice | null; role?: TrackRole | null };

/**
 * Applies what the game master accepted, as one undo step, in batches when
 * there are many (DB review 1); await the result. Null or missing parts are left alone.
 */
export function applyTitleSuggestions(store: Store, accepted: AcceptedSuggestion[]): Promise<void> {
  if (!Array.isArray(accepted)) throw new ValidationError("accepted", "accepted must be a list.");
  return store.changeInBatches(`Apply suggestions to ${plural(accepted.length, "track")}`, accepted, (batch) => {
    for (const item of batch) {
      const record = v.record("suggestion", item);
      const trackId = v.id("trackId", record.trackId);
      // Inside this batch's transaction, so it is done at once.
      if (item.tagIds && item.tagIds.length > 0) void tagTracks(store, [trackId], item.tagIds);
      const patch: TrackPatch = {};
      if (item.loopable) patch.loopable = item.loopable;
      if (item.role) patch.role = item.role;
      if (Object.keys(patch).length > 0) updateTrack(store, trackId, patch);
    }
  });
}
