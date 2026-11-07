import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ARTICLES, HELP_GROUPS, articleWordCount, blocksOf, parseArticle, searchArticles } from "./articles";

const FOLDER = path.join(__dirname, "articles");

describe("the help articles (FND-8)", () => {
  it("has every Markdown file in src/lyre/help/articles, in the order of their file names", () => {
    const files = fs.readdirSync(FOLDER).filter((f) => f.endsWith(".md")).sort();
    expect(ARTICLES.map((a) => a.file)).toEqual(files);
    expect(files).toHaveLength(15);
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
      "Connect Discord and bring a bot into a room",
      "What came across from Kenku FM",
      "Add your music and tag it",
      "Make a playlist from tags",
      "Plan a campaign, session and scenes",
      "How a track plays (Audio profile)",
      "Pad boards",
      "Shuffle and repeat per place",
      "Normalise volume",
      "Run a session in Live",
      "Preview or play on air",
      "Back up, move or share",
      "Find missing files",
      "Save diagnostics for a bug report",
      "Play next, Add to queue and Repeat",
    ]);
  });

  it("avoids the words Nik asked to keep out", () => {
    for (const a of ARTICLES) expect(a.body + a.title, a.file).not.toMatch(/\b(genuinely|honestly|does real work|carry|carries|carried)\b/i);
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
