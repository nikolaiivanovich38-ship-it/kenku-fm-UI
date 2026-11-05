/**
 * DB review item 1: bulk work never holds the main process for long, because
 * Discord's audio is fed from it (a 200 ms queue). A bulk change is saved in
 * batches with the event loop free between them, and is still one undo step;
 * undoing a large step works the same way. While one runs, other edits wait.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection } from "./sqlite";
import { MIGRATIONS, migrate } from "./schema";
import { STATEMENT_CACHE_SIZE, Store } from "./store";
import { UndoHistory, undoableTables } from "./undo";
import { LibraryBusyError } from "./errors";
import { makeClock } from "./test/helpers";
import { createTracks } from "./repo/tracks";
import { createCampaign } from "./repo/campaigns";

function setup(options: { batchEntries?: number } = {}) {
  const clock = makeClock();
  const db = openConnection(":memory:");
  migrate(db, MIGRATIONS, clock.now);
  const store = new Store(db, { now: clock.now });
  const history = new UndoHistory(store, { batchEntries: options.batchEntries });
  return { db, store, history };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup({ batchEntries: 4 });
});
afterEach(() => t.db.close());

const snapshot = () =>
  Object.fromEntries(undoableTables(t.db).map((table) => [table.name, t.store.all(`SELECT * FROM ${table.name} ORDER BY ${table.primaryKey.join(", ")}`)]));

/** Counts the event-loop turns that ran while `work` was going on. */
async function turnsDuring(work: () => Promise<unknown>): Promise<number> {
  let turns = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    turns++;
    setImmediate(tick);
  };
  setImmediate(tick);
  try {
    await work();
  } finally {
    running = false;
  }
  return turns;
}

const titles = () => t.store.all<{ title: string }>("SELECT title FROM tracks ORDER BY added_seq").map((r) => r.title);

function addTitles(batch: string[]) {
  for (const title of batch) {
    t.store.run("INSERT INTO tracks (id, title, path, created_at, updated_at) VALUES (?, ?, ?, 1, 1)", title, title, `/m/${title}.mp3`);
  }
}

describe("changes saved in batches (DB review 1)", () => {
  it("saves a large change in batches, lets other work run between them, and records one undo step", async () => {
    const before = snapshot();
    const seen: number[] = [];
    const turns = await turnsDuring(() =>
      t.store.changeInBatches("Add 10 tracks", ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], (batch, last) => {
        seen.push(batch.length);
        addTitles(batch);
        if (last) t.store.run("UPDATE tracks SET notes = 'last batch' WHERE id = 'j'");
      }, { batchSize: 3 }),
    );
    expect(seen).toEqual([3, 3, 3, 1]);
    expect(turns).toBeGreaterThanOrEqual(3);
    expect(titles()).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(t.history.state()).toMatchObject({ canUndo: true, undoLabel: "Add 10 tracks" });
    const after = snapshot();

    // Undoing 10 rows with batches of 4 entries also lets other work run.
    expect(await turnsDuring(async () => expect(await t.history.undo()).toBe("Add 10 tracks"))).toBeGreaterThanOrEqual(2);
    expect(snapshot()).toEqual(before);
    expect(await t.history.redo()).toBe("Add 10 tracks");
    expect(snapshot()).toEqual(after);
    expect(t.db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("puts back the batches already saved when a later one fails, and records no step", async () => {
    createCampaign(t.store, { name: "Kept" });
    const before = snapshot();
    await expect(
      t.store.changeInBatches("Add tracks", ["a", "b", "c", "d", "a"], (batch) => addTitles(batch), { batchSize: 2 }),
    ).rejects.toThrow(/UNIQUE/);
    expect(snapshot()).toEqual(before);
    expect(t.history.state()).toMatchObject({ undoLabel: 'Add campaign "Kept"' });
  });

  it("is part of the change it runs in, and runs in one go when the list is short", async () => {
    t.store.change("Outer", () => {
      void t.store.changeInBatches("Inner", ["a", "b", "c"], (batch) => addTitles(batch), { batchSize: 1 });
      expect(titles()).toEqual(["a", "b", "c"]);
    });
    const short = t.store.changeInBatches("Short", ["d"], (batch) => addTitles(batch), { batchSize: 5 });
    expect(titles()).toEqual(["a", "b", "c", "d"]);
    await short;
    expect(t.history.state().undoLabel).toBe("Short");
    expect(await t.history.undo()).toBe("Short");
    expect(await t.history.undo()).toBe("Outer");
    expect(titles()).toEqual([]);
  });

  it("makes other edits, undo and a second bulk change wait with a plain message while it runs", async () => {
    const running = t.store.changeInBatches("Add tracks", ["a", "b", "c", "d"], (batch) => addTitles(batch), { batchSize: 1 });
    expect(t.store.busyWith).toBe("Add tracks");
    expect(() => createCampaign(t.store, { name: "X" })).toThrow(LibraryBusyError);
    expect(() => createCampaign(t.store, { name: "X" })).toThrow(/still saving "Add tracks"/);
    expect(() => t.store.changeWithoutHistory((): void => undefined)).toThrow(LibraryBusyError);
    expect(() => t.history.undo()).toThrow(LibraryBusyError);
    expect(() => t.store.changeInBatches("Other", ["x", "y"], (): void => undefined, { batchSize: 1 })).toThrow(LibraryBusyError);
    // Reading is fine while it runs.
    expect(Array.isArray(titles())).toBe(true);
    await running;
    expect(t.store.busyWith).toBeNull();
    createCampaign(t.store, { name: "Now" });
  });

  it("undoes a large step that cascaded (deleting tracks) in batches, exactly", async () => {
    const tracks = createTracks(
      t.store,
      ["a", "b", "c", "d", "e"].map((title) => ({ title, file: { path: `/m/${title}.mp3` }, notes: title })),
    );
    const before = snapshot();
    await t.store.changeInBatches("Delete 5 tracks", tracks.map((x) => x.id), (batch) => {
      for (const id of batch) t.store.run("DELETE FROM tracks WHERE id = ?", id);
    }, { batchSize: 2 });
    const after = snapshot();
    await t.history.undo();
    expect(snapshot()).toEqual(before);
    await t.history.redo();
    expect(snapshot()).toEqual(after);
  });
});

describe("connection upkeep (review nice-to-haves)", () => {
  it("keeps at most a few hundred prepared statements, dropping the least used", () => {
    for (let n = 1; n <= STATEMENT_CACHE_SIZE + 50; n++) t.store.all(`SELECT id FROM tracks WHERE id IN (${Array.from({ length: n }, () => "?").join(", ")})`, ...Array.from({ length: n }, () => "x"));
    expect(t.store.cachedStatements).toBe(STATEMENT_CACHE_SIZE);
  });
});
