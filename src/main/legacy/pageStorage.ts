/**
 * Reads one value of a page's own localStorage from the main process, in a world of its own: the page's scripts
 * cannot change what localStorage.getItem does there, so what is read is what is stored. Used for what the old main
 * window and the old player kept in the storage they share with the Lyre page (FND-16, DAT-9).
 */

/** The isolated world the reads run in (any id other than 0, the page's own world). */
export const STORAGE_READ_WORLD = 1999;

export interface StoragePage {
  isDestroyed(): boolean;
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown>;
}

/** The stored text for `key`, or null when there is none; rejects when the page has gone. */
export async function readPageStorage(page: StoragePage | undefined, key: string): Promise<unknown> {
  if (!page || page.isDestroyed()) throw new Error("The page has closed");
  return page.executeJavaScriptInIsolatedWorld(STORAGE_READ_WORLD, [{ code: `localStorage.getItem(${JSON.stringify(key)})` }]);
}
