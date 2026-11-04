/** An in-memory library at the latest schema, for repository tests. */
import { openConnection } from "../sqlite";
import { MIGRATIONS, migrate } from "../schema";
import { Store } from "../store";
import { makeClock } from "./helpers";

export function makeTestStore() {
  const clock = makeClock();
  const db = openConnection(":memory:");
  migrate(db, MIGRATIONS, clock.now);
  const store = new Store(db, { now: clock.now });
  return { store, db, clock, close: () => db.close() };
}
