/**
 * Builds the player's list of built-in background pictures from the files
 * webpack bundles (see index.ts). Kept free of webpack so it can be tested.
 */

/** What webpack's require.context hands back: file keys ("./tavern.jpg") and a loader. */
export type ImageContext = {
  keys(): string[];
  (key: string): unknown;
};

/** The bundled address of a picture: a string, or `{ default: string }` for ES-module output. */
function addressOf(loaded: unknown): string | undefined {
  const address =
    loaded && typeof loaded === "object" && "default" in loaded ? (loaded as { default: unknown }).default : loaded;
  return typeof address === "string" && address !== "" ? address : undefined;
}

/**
 * `{ name: address }` for every picture, named after its file ("./tavern.jpg"
 * is "tavern"). "blank" is always there: Cue Desk 0.1.0 saved it on every new
 * playlist and soundboard, and they must keep showing it (0.1.1 review).
 */
export function backgroundsFrom(context: ImageContext, blank: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const key of context.keys()) {
    const address = addressOf(context(key));
    if (address) {
      found[key.replace(/^\.\//, "").replace(/\.[^.]*$/, "")] = address;
    }
  }
  return { ...found, blank };
}

/** A random picture for a new playlist or soundboard; blank only when there is nothing else. */
export function randomBackgroundFrom(backgrounds: Record<string, string>): string {
  const pictures = Object.keys(backgrounds).filter((key) => key !== "blank");
  const keys = pictures.length > 0 ? pictures : ["blank"];
  return keys[Math.floor(Math.random() * keys.length)];
}
