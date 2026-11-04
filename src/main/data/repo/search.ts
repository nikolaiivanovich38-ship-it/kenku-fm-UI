/**
 * Instant search (ORG-1) over the FTS5 index kept by the schema's triggers.
 *
 * Every word typed must match the start of a word somewhere in a result
 * ("dark fo" finds "Dark forest"). Tracks are found by title, file name, tag
 * names and synonyms, marker labels, notes and source (composer, album, cue
 * number); playlists and boards by title; campaigns, sessions and scenes by
 * name and notes. Results are ranked with BM25, with a title match counting
 * most.
 */
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import * as v from "../validate";

export const SEARCH_KINDS = ["track", "playlist", "board", "campaign", "session", "scene"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** Lower is better (BM25 as SQLite reports it). */
  score: number;
};

export type SearchOptions = {
  /** Only these kinds of result. */
  kinds?: SearchKind[];
  /** Only tracks in this playlist. */
  playlistId?: string;
  /** Only tracks on this board. */
  boardId?: string;
  /** At most this many results (default 50). */
  limit?: number;
};

/**
 * Column weights for BM25, in the index's column order:
 * title, file name, tags, markers, notes, source.
 */
const WEIGHTS = [10, 4, 6, 3, 1, 2];

/**
 * Turns what the user typed into an FTS5 query: each word becomes a quoted
 * prefix term, so FTS5 syntax (AND, NEAR, column:, *) is just text. Double
 * quotes are dropped (the index ignores them anyway). Null when there is
 * nothing to search for.
 */
/** A letter or digit in any script. Built at run time: the TypeScript target predates the u flag. */
const LETTER_OR_DIGIT = new RegExp("[\\p{L}\\p{N}]", "u");

export function matchQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((word) => word.replace(/"/g, ""))
    .filter((word) => LETTER_OR_DIGIT.test(word))
    .map((word) => `"${word}"*`);
  return terms.length === 0 ? null : terms.join(" ");
}

export function search(store: Store, text: string, options: SearchOptions = {}): SearchHit[] {
  const query = matchQuery(v.optionalText("text", text, v.MAX_NAME_LENGTH));
  if (query === null) return [];
  const limit = options.limit === undefined ? 50 : v.integer("limit", options.limit, 1, 1000);
  const where: string[] = ["search_fts MATCH ?"];
  const params: SQLInputValue[] = [query];
  if (options.kinds !== undefined) {
    const kinds = options.kinds.map((kind, index) => v.oneOf(`kinds[${index}]`, kind, SEARCH_KINDS));
    if (kinds.length === 0) return [];
    where.push(`d.kind IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  if (options.playlistId !== undefined) {
    where.push("d.kind = 'track' AND d.ref_id IN (SELECT track_id FROM playlist_items WHERE playlist_id = ?)");
    params.push(v.id("playlistId", options.playlistId));
  }
  if (options.boardId !== undefined) {
    where.push(
      "d.kind = 'track' AND d.ref_id IN (SELECT s.track_id FROM pad_sounds s JOIN pads p ON p.id = s.pad_id WHERE p.board_id = ?)",
    );
    params.push(v.id("boardId", options.boardId));
  }
  return store
    .all<{ kind: SearchKind; id: string; title: string; score: number }>(
      `SELECT d.kind AS kind, d.ref_id AS id, search_fts.title AS title, bm25(search_fts, ${WEIGHTS.join(", ")}) AS score
       FROM search_fts JOIN search_docs d ON d.doc_id = search_fts.rowid
       WHERE ${where.join(" AND ")}
       ORDER BY score, title COLLATE NOCASE
       LIMIT ?`,
      ...params,
      limit,
    )
    .map((row) => ({ kind: row.kind, id: row.id, title: row.title, score: row.score }));
}
