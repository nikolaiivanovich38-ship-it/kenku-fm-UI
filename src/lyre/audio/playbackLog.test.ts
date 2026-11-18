/** 52: the log line Save diagnostics keeps when a track does not play as long as the library says. */
import { describe, expect, it } from "vitest";

import { clock, endingLine, type EndingFacts } from "./playbackLog";

const facts = (over: Partial<EndingFacts> & { ending: EndingFacts["ending"] }): EndingFacts => ({
  title: "Monster Books / Boggarts!",
  fileName: "12 - Monster Books.mp3",
  libraryMs: 148_000,
  where: "Table, music",
  sourceKind: "stream",
  ...over,
});

describe("endingLine (52)", () => {
  it("names a track whose file ran out long before the library's length", () => {
    expect(endingLine(facts({ ending: { how: "file end", atSeconds: 3.03, fileSeconds: 3.03, endSeconds: null, message: null, sourceKind: null } }))).toBe(
      'Lyre playback: "Monster Books / Boggarts!" (12 - Monster Books.mp3, streamed) in Table, music ended early, at 0:03.0: the file ran out; the file says 0:03.0, the library has 2:28.0.',
    );
  });

  it("names a track that failed, with why and where", () => {
    expect(endingLine(facts({ where: "preview", sourceKind: "buffer", ending: { how: "failed", atSeconds: 4.2, fileSeconds: 148, endSeconds: null, message: "The audio file stopped playing", sourceKind: null } }))).toBe(
      'Lyre playback: "Monster Books / Boggarts!" (12 - Monster Books.mp3, in memory) in preview failed at 0:04.2: The audio file stopped playing; the file says 2:28.0, the library has 2:28.0.',
    );
  });

  it("names a track that played to the end of a file longer than the library says (a wrong length in the library)", () => {
    expect(endingLine(facts({ libraryMs: 3030, ending: { how: "file end", atSeconds: 148, fileSeconds: 148, endSeconds: null, message: null, sourceKind: null } }))).toContain(
      "played to the end of its file at 2:28.0; the file says 2:28.0, the library has 0:03.0, so the library's length is wrong.",
    );
  });

  it("says nothing for a track that played its length, stopped at an End, or was stopped", () => {
    expect(endingLine(facts({ ending: { how: "file end", atSeconds: 147.6, fileSeconds: 147.6, endSeconds: null, message: null, sourceKind: null } }))).toBeNull();
    expect(endingLine(facts({ ending: { how: "end", atSeconds: 30, fileSeconds: 148, endSeconds: 30, message: null, sourceKind: null } }))).toBeNull();
    expect(endingLine(facts({ ending: { how: "stopped", atSeconds: 10, fileSeconds: 148, endSeconds: null, message: null, sourceKind: null } }))).toBeNull();
  });

  it("writes times as minutes and seconds to a tenth", () => {
    expect(clock(0)).toBe("0:00.0");
    expect(clock(61.25)).toBe("1:01.3");
    expect(clock(599.96)).toBe("10:00.0");
  });
});
