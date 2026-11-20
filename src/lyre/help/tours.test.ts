/**
 * The tours find their controls by the names a person (and a screen reader) knows them by: aria-labelledby, aria-label,
 * a field's label, else the words shown without what is hidden from screen readers (tours.ts nameOf). The end-to-end
 * check (help.spec "a tour per screen") goes through every tour on the real screens; these keep the finders honest.
 */
import { afterEach, describe, expect, it } from "vitest";
import { TOURS, type TourDef } from "./tours";

const step = (def: TourDef, title: string) => {
  const found = def.steps.find((s) => s.title === title);
  if (!found) throw new Error(`no step ${title}`);
  return found;
};

function screenWith(html: string) {
  document.body.innerHTML = `<main id="view">${html}</main>`;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the tours' finders", () => {
  it("Move a room points at the room's bot button, where the room's menu is", () => {
    screenWith(`
      <div role="group" aria-labelledby="h"><h3 id="h">Table</h3>
        <button aria-label="Mute Table">m</button>
        <input type="range" aria-label="Volume in Table">
        <button aria-haspopup="menu" aria-label="Lyre Table in Table: change">Lyre Table</button>
        <button aria-label="Make Lyre Table leave Table">Leave</button>
      </div>`);
    expect(step(TOURS.rooms, "Move a room").target()).toHaveAccessibleName(
      "Lyre Table in Table: change",
    );
  });

  it("a field is known by its label: Starting volume and Your title", () => {
    screenWith(
      `<label for="v">Starting volume</label><input type="range" id="v"><label for="lb-title">Your title</label><input id="lb-title">`,
    );
    expect(step(TOURS.settings, "Starting volume").target()).toBe(
      document.getElementById("v"),
    );
    expect(step(TOURS.details, "Your title").target()).toBe(
      document.getElementById("lb-title"),
    );
  });

  it("Replace… is found by its fuller name, Replace the token of …", () => {
    screenWith(
      `<button aria-label="Replace the token of Lyre Table">Replace…</button>`,
    );
    expect(step(TOURS.settings, "Your bot").target()).toHaveTextContent(
      "Replace…",
    );
  });

  it("Use it for and At its end are groups named by their headings", () => {
    screenWith(`
      <div id="u">Use it for</div><div role="group" aria-labelledby="u"><button aria-pressed="false">Background</button></div>
      <div id="e">At its end</div><div role="group" aria-labelledby="e"><button aria-pressed="true">Loop</button></div>`);
    expect(step(TOURS.details, "Use it for").target()).toHaveAccessibleName(
      "Use it for",
    );
    expect(step(TOURS.details, "At its end").target()).toHaveAccessibleName(
      "At its end",
    );
  });

  it("a scene's name is read without its number badge, which screen readers do not hear", () => {
    screenWith(
      `<button aria-expanded="false"><span aria-hidden="true">3</span><span><span class="sr-only">Scene 3:</span> The abbey ruins</span></button>`,
    );
    expect(step(TOURS.session, "Open a scene").target()).toHaveTextContent(
      "The abbey ruins",
    );
  });

  it("Sort is the playlists' sort button, whose words are the order it shows", () => {
    screenWith(
      `<button aria-haspopup="menu" title="Sort the playlists">Your order</button>`,
    );
    expect(step(TOURS.playlists, "Sort").target()).toHaveTextContent(
      "Your order",
    );
  });

  it("Play mode and While it plays are found as a row of choices or as one control", () => {
    screenWith(
      `<div role="group" aria-label="Play mode"><button>One-shot</button></div><label for="d">While it plays</label><select id="d"></select>`,
    );
    expect(step(TOURS.board, "Play mode").target()).toHaveAccessibleName(
      "Play mode",
    );
    expect(step(TOURS.board, "While it plays").target()).toBe(
      document.getElementById("d"),
    );
    screenWith(
      `<div role="radiogroup" aria-label="While it plays"><button>Music gets quieter</button></div>`,
    );
    expect(step(TOURS.board, "While it plays").target()).toHaveAccessibleName(
      "While it plays",
    );
  });
});
