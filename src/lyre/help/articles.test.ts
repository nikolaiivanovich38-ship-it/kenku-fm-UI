import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ARTICLES, HELP_GROUPS, articleWordCount, blocksOf, parseArticle, searchArticles } from "./articles";

const FOLDER = path.join(__dirname, "articles");

describe("the help articles (FND-8)", () => {
  it("has every Markdown file in src/lyre/help/articles, in the order of their file names", () => {
    const files = fs.readdirSync(FOLDER).filter((f) => f.endsWith(".md")).sort();
    expect(ARTICLES.map((a) => a.file)).toEqual(files);
    // 15 in 0.5.2; 0.6.0's streams add theirs (r10-tracks: 17, 18, 19 and 21).
    expect(files.length).toBeGreaterThanOrEqual(17);
  });

  it("gives each a title, one of the task groups and an id from its file name", () => {
    for (const a of ARTICLES) {
      expect(a.title.length, a.file).toBeGreaterThan(3);
      expect(HELP_GROUPS, a.file).toContain(a.group);
      expect(a.id).toBe(a.file.replace(/^\d+-/, "").replace(/\.md$/, ""));
    }
    expect(new Set(ARTICLES.map((a) => a.id)).size).toBe(ARTICLES.length);
    expect(HELP_GROUPS).toEqual(["Get started", "Prepare", "Run a session", "Your library"]);
  });

  it("keeps every article under 300 words", () => {
    for (const a of ARTICLES) expect(articleWordCount(a), a.file).toBeLessThan(300);
  });

  it("covers the tasks in the backlog", () => {
    expect(ARTICLES.map((a) => a.title)).toEqual([
      "Connect Discord and add a bot to a room",
      "What came across from Kenku FM",
      "Add your music and tag it",
      "Make a playlist from tags",
      "Plan a campaign, session and scenes",
      "How a track plays (Audio profile)",
      "Pad boards",
      "Shuffle and repeat in playlists and scenes",
      "Normalise volume",
      "Run a session in Live",
      "Preview or play on air",
      "Back up, move or share",
      "Find missing files",
      "Save diagnostics for a bug report",
      "Play next, Add to queue and Repeat",
      // 0.6.0, in file order: r10-live 16 and 20, r10-tracks 17, 18, 19 and 21.
      "Rooms and bots",
      "A track's details anywhere",
      "Filters, columns and sorting",
      "Split a track into parts",
      "Dip the music under effects",
      "The queue, Back and Forward",
    ]);
  });

  it("avoids the words Nik asked to keep out", () => {
    for (const a of ARTICLES) expect(a.body + a.title, a.file).not.toMatch(/\b(genuinely|honestly|does real work|carry|carries|carried)\b/i);
  });

  it("matches its draft in design/prototype/help-drafts word for word, where there is one", () => {
    const drafts = path.join(__dirname, "../../../design/prototype/help-drafts");
    for (const file of fs.readdirSync(drafts).filter((f) => f.endsWith(".md"))) {
      expect(fs.readFileSync(path.join(FOLDER, file), "utf8"), file).toBe(fs.readFileSync(path.join(drafts, file), "utf8"));
    }
  });

  it("says to press a room's name to move it (round 9, item 56), not its bot button", () => {
    for (const file of ["10-live.md", "16-rooms-and-bots.md"]) {
      const a = ARTICLES.find((x) => x.file === file)!;
      expect(a.body, file).toMatch(/room's name/);
      expect(a.body, file).not.toMatch(/bot button/);
    }
  });
});

describe("the article format", () => {
  const sample = "---\ntitle: A title\ngroup: Prepare\nwords: extra words\n---\nFirst line\nsame paragraph.\n\n1. Press **Add**.\n2. Press `Enter`.\n\n- one\n- two\n";

  it("reads the head between --- lines", () => {
    expect(parseArticle("07-a-thing.md", sample)).toMatchObject({ id: "a-thing", title: "A title", group: "Prepare", words: "extra words" });
  });

  it("reads Windows line ends too", () => {
    expect(parseArticle("x.md", sample.replace(/\n/g, "\r\n")).title).toBe("A title");
  });

  it("refuses a file without a head or a title", () => {
    expect(() => parseArticle("x.md", "no head")).toThrow(/x\.md/);
    expect(() => parseArticle("x.md", "---\ngroup: Prepare\n---\nText")).toThrow(/title/);
  });

  it("splits the text into paragraphs, steps and lists, with labels and keys marked", () => {
    expect(blocksOf(parseArticle("x.md", sample).body)).toEqual([
      { kind: "p", lines: [[{ text: "First line same paragraph." }]] },
      { kind: "ol", lines: [[{ text: "Press " }, { text: "Add", mark: "label" }, { text: "." }], [{ text: "Press " }, { text: "Enter", mark: "key" }, { text: "." }]] },
      { kind: "ul", lines: [[{ text: "one" }], [{ text: "two" }]] },
    ]);
  });
});

describe("searching help", () => {
  it("lists every article for an empty search", () => {
    expect(searchArticles("  ")).toHaveLength(ARTICLES.length);
  });

  it("needs every word, found in the title, the search words or the text, and puts title hits first", () => {
    expect(searchArticles("token").map((a) => a.id)).toContain("connect-discord");
    expect(searchArticles("shuffle repeat")[0].id).toBe("play-order");
    expect(searchArticles("SHUFFLE")[0].id).toBe("play-order");
    expect(searchArticles("zzzz")).toEqual([]);
    expect(searchArticles("token zzzz")).toEqual([]);
  });

  it("reads labels and keys as plain words", () => {
    expect(searchArticles("Shift+Esc").map((a) => a.id)).toContain("live");
  });
});
