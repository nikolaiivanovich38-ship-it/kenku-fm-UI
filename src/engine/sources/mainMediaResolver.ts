/**
 * BUG-10 and PLY-11: files on this computer are prepared by the main process
 * before they play (src/main/media). It answers the address to play:
 *
 * - the file itself, for formats the player plays;
 * - a converted copy in Lyre's cache folder, for formats it does not (WMA
 *   and others; converted once, then reused);
 * - with `keepLocal`, a copy on this computer's disk once one is ready.
 *
 * The main process checks the file is in a library folder first. Other
 * addresses (web addresses, blob:) are left as they are. The Lyre page is
 * answered with a lyre-media: address granted to it alone (security review
 * 6: its Content-Security-Policy allows no file: address); the old player
 * is answered with the file: address.
 */
import type { MediaRequest, MediaResolver, ResolvedMedia } from "./sourceLoader";

/** The answer of the main process: an address to play, or a plain-language reason it cannot be played. */
export type PrepareAnswer = { url: string } | { error: string };

/** The player preload's bridge to the MEDIA_PREPARE channel. */
export interface MediaBridge {
  prepare(url: string, options: { keepLocal: boolean }): Promise<PrepareAnswer>;
}

const isFileAddress = (url: string) => /^file:/i.test(url);
/** What the main process may answer: a file on this computer, or the Lyre page's grant for one. */
const isPreparedAddress = (url: string) => isFileAddress(url) || /^lyre-media:\/\//i.test(url);

export class MainMediaResolver implements MediaResolver {
  constructor(private readonly bridge: MediaBridge) {}

  async resolve(request: MediaRequest): Promise<ResolvedMedia> {
    if (!isFileAddress(request.url)) {
      return { url: request.url, sizeBytes: request.sizeBytes };
    }
    const answer = await this.bridge.prepare(request.url, { keepLocal: Boolean(request.keepLocal) });
    if ("error" in answer) {
      throw new Error(answer.error);
    }
    // The answer is always a file on this computer; anything else is a fault, never played.
    if (typeof answer.url !== "string" || !isPreparedAddress(answer.url)) {
      throw new Error("This file could not be prepared for playing.");
    }
    return { url: answer.url };
  }
}
