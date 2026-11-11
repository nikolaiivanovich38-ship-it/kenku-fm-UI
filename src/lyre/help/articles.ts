/**
 * FND-8: the help articles, one Markdown file each in ./articles (docs/DEVELOPING.md "Help articles"). The design
 * prototype reads the same files (design/prototype/src/build.js), so its words and the app's are the same.
 *
 * A file starts with its head between two `---` lines: `title`, `group` (one of HELP_GROUPS) and `words` (more words
 * that find it in a search). Then paragraphs, `- ` lists and `1. ` steps, each item on one line; `**Label**` names
 * something on screen and `` `Key` `` is a key. Nothing else is read as Markdown, so an article cannot hold a link,
 * a picture or HTML: help never opens anything.
 */
import connectDiscord from "./articles/01-connect-discord.md?raw";
import kenkuFm from "./articles/02-kenku-fm.md?raw";
import addMusic from "./articles/03-add-music.md?raw";
import dynamicPlaylist from "./articles/04-dynamic-playlist.md?raw";
import planCampaign from "./articles/05-plan-campaign.md?raw";
import audioProfile from "./articles/06-audio-profile.md?raw";
import padBoards from "./articles/07-pad-boards.md?raw";
import playOrder from "./articles/08-play-order.md?raw";
import normalise from "./articles/09-normalise.md?raw";
import live from "./articles/10-live.md?raw";
import previewOnAir from "./articles/11-preview-on-air.md?raw";
import backup from "./articles/12-backup.md?raw";
import missingFiles from "./articles/13-missing-files.md?raw";
import diagnostics from "./articles/14-diagnostics.md?raw";
import upNext from "./articles/15-up-next.md?raw";

/** The task groups, in the order the panel lists them. */
export const HELP_GROUPS = ["Get started", "Prepare", "Run a session", "Your library"] as const;
export type HelpGroup = (typeof HELP_GROUPS)[number];

export interface HelpArticle {
  /** From the file name without its number: "connect-discord". */
  id: string;
  file: string;
  title: string;
  group: HelpGroup;
  /** More words a search finds it by. */
  words: string;
  /** The text after the head, as written. */
  body: string;
}

/** A run of text; `label` is something named on screen (bold), `key` a key on the keyboard. */
export interface HelpSpan {
  text: string;
  mark?: "label" | "key";
}
export interface HelpBlock {
  kind: "p" | "ul" | "ol";
  /** A paragraph has one line; a list one per item. */
  lines: HelpSpan[][];
}

export function parseArticle(file: string, text: string): HelpArticle {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`Help article ${file} has no head between --- lines`);
  const head: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) head[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  if (!head.title) throw new Error(`Help article ${file} has no title`);
  const group = HELP_GROUPS.find((g) => g === head.group);
  if (!group) throw new Error(`Help article ${file}: group must be one of ${HELP_GROUPS.join(", ")}`);
  return { id: file.replace(/^\d+-/, "").replace(/\.md$/, ""), file, title: head.title, group, words: head.words ?? "", body: match[2].trim() };
}

/** `**Label**` and `` `Key` `` in a line. */
function spansOf(line: string): HelpSpan[] {
  const spans: HelpSpan[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) spans.push({ text: line.slice(at, m.index) });
    spans.push(m[1] !== undefined ? { text: m[1], mark: "label" } : { text: m[2], mark: "key" });
    at = m.index + m[0].length;
  }
  if (at < line.length) spans.push({ text: line.slice(at) });
  return spans;
}

export function blocksOf(body: string): HelpBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines): HelpBlock => {
      if (lines.every((l) => /^- /.test(l))) return { kind: "ul", lines: lines.map((l) => spansOf(l.slice(2))) };
      if (lines.every((l) => /^\d+\. /.test(l))) return { kind: "ol", lines: lines.map((l) => spansOf(l.replace(/^\d+\. /, ""))) };
      return { kind: "p", lines: [spansOf(lines.join(" "))] };
    });
}

/** The text as read, without the marks. */
export function plainText(body: string): string {
  return body.replace(/\*\*|`/g, "");
}

export function articleWordCount(article: HelpArticle): number {
  return (article.title + " " + plainText(article.body).replace(/^\s*(?:- |\d+\. )/gm, "")).split(/\s+/).filter(Boolean).length;
}

const FILES: Record<string, string> = {
  "01-connect-discord.md": connectDiscord,
  "02-kenku-fm.md": kenkuFm,
  "03-add-music.md": addMusic,
  "04-dynamic-playlist.md": dynamicPlaylist,
  "05-plan-campaign.md": planCampaign,
  "06-audio-profile.md": audioProfile,
  "07-pad-boards.md": padBoards,
  "08-play-order.md": playOrder,
  "09-normalise.md": normalise,
  "10-live.md": live,
  "11-preview-on-air.md": previewOnAir,
  "12-backup.md": backup,
  "13-missing-files.md": missingFiles,
  "14-diagnostics.md": diagnostics,
  "15-up-next.md": upNext,
};

export const ARTICLES: readonly HelpArticle[] = Object.keys(FILES)
  .sort()
  .map((file) => parseArticle(file, FILES[file]));

/**
 * Every word typed must be in the title, the search words or the text (any case); articles with the words in their
 * title come first, then in the search words, then the rest, each in the panel's order. The prototype's
 * `L.helpSearch` (views/help.js) is the same rule.
 */
export function searchArticles(query: string, articles: readonly HelpArticle[] = ARTICLES): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return articles.slice();
  const scored: { article: HelpArticle; score: number; at: number }[] = [];
  articles.forEach((article, at) => {
    const title = article.title.toLowerCase();
    const extra = article.words.toLowerCase();
    const all = `${title} ${extra} ${plainText(article.body).toLowerCase()}`;
    let score = 0;
    for (const word of words) {
      if (!all.includes(word)) return;
      score += title.includes(word) ? 3 : extra.includes(word) ? 2 : 1;
    }
    scored.push({ article, score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.article);
}
