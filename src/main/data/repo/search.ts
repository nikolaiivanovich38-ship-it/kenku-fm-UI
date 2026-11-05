/**
 * Instant search (ORG-1) over the FTS5 index kept by the schema's triggers.
 *
 * Every word typed must match the start of a word somewhere in a result
 * ("dark fo" finds "Dark forest"). Tracks are found by their three names (the
 * game master's title, the file-tag title, the file name), artist, album, tag
 * names and synonyms, marker labels, notes and cue number; playlists and
 * boards by title (playlists also by notes); campaigns, sessions and scenes by
 * name and notes. Results are ranked with BM25, with a title match counting
 * most. A track's result shows the name it is shown by (its title, else its
 * file-tag title, else its file name).
 */
import type { Lane } from "../../../common/domain";
import type { SQLInputValue } from "../sqlite";
import { LANES } from "../types";
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
  /**
   * Only tracks of one lane, as the Library's kind filter shows them: music or
   * ambience by kind; FX is sound effects and stings (isFx in src/common/domain).
   */
  lane?: Lane;
  /** At most this many results (default 50). */
  limit?: number;
};

/**
 * Column weights for BM25, in the index's column order (schema/v002-design.ts):
 * title, file-tag title, file name, artist, album, tags, markers, notes, cue number.
 */
const WEIGHTS = [10, 6, 4, 3, 3, 6, 3, 1, 2];

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

/**
 * The search as SQL: the FTS5 index finds the words, search_docs (its primary
 * key) says what each document is. Null when there is nothing to search for.
 * Exported for the query-plan tests.
 */
export function searchQuery(text: string, options: SearchOptions = {}): { sql: string; params: SQLInputValue[] } | null {
  const query = matchQuery(v.optionalText("text", text, v.MAX_NAME_LENGTH));
  if (query === null) return null;
  const limit = options.limit === undefined ? 50 : v.integer("limit", options.limit, 1, 1000);
  const where: string[] = ["search_fts MATCH ?"];
  const params: SQLInputValue[] = [query];
  if (options.kinds !== undefined) {
    const kinds = options.kinds.map((kind, index) => v.oneOf(`kinds[${index}]`, kind, SEARCH_KINDS));
    if (kinds.length === 0) return null;
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
  if (options.lane !== undefined) {
    const lane = v.oneOf("lane", options.lane, LANES);
    // One look-up by key per word match: cheaper than listing a whole lane first (the music lane is most of a library).
    where.push(
      lane === "fx"
        ? "d.kind = 'track' AND EXISTS (SELECT 1 FROM tracks t WHERE t.id = d.ref_id AND (t.kind = 'fx' OR t.role = 'sting'))"
        : "d.kind = 'track' AND EXISTS (SELECT 1 FROM tracks t WHERE t.id = d.ref_id AND t.kind = ?)",
    );
    if (lane !== "fx") params.push(lane);
  }
  return {
    sql: `SELECT d.kind AS kind, d.ref_id AS id, search_fts.title AS title, bm25(search_fts, ${WEIGHTS.join(", ")}) AS score
       FROM search_fts JOIN search_docs d ON d.doc_id = search_fts.rowid
       WHERE ${where.join(" AND ")}
       ORDER BY score, title COLLATE NOCASE
       LIMIT ?`,
    params: [...params, limit],
  };
}

/** How many results `search` would find with no limit ("Show 25 more of 80"). */
export function searchCount(store: Store, text: string, options: Omit<SearchOptions, "limit"> = {}): number {
  const query = searchQuery(text, { ...options, limit: 1 });
  if (query === null) return 0;
  // The same match and filters, counted: no ranking, no sort.
  const where = query.sql.slice(query.sql.indexOf("FROM search_fts"), query.sql.indexOf("ORDER BY"));
  return (store.get<{ n: number }>(`SELECT count(*) AS n ${where}`, ...query.params.slice(0, -1)) as { n: number }).n;
}

export function search(store: Store, text: string, options: SearchOptions = {}): SearchHit[] {
  const query = searchQuery(text, options);
  if (query === null) return [];
  return store
    .all<{ kind: SearchKind; id: string; title: string; score: number }>(query.sql, ...query.params)
    .map((row) => ({ kind: row.kind, id: row.id, title: row.title, score: row.score }));
}
