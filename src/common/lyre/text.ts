/** Small wording helpers both LyreApi implementations use, so they name things the same way. */
import type { DomainTrack } from "../domain";

/** The name a track is shown by: your title, else the title in the file, else the file name. */
export const shownTitle = (t: Pick<DomainTrack, "title" | "metaTitle" | "fileName">): string => t.title || t.metaTitle || t.fileName;
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const quoted = (s: string): string => `"${s}"`;
/** Text with its spaces tidied; "" for anything that is not text. */
export const trimmed = (s: unknown): string => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");
/** A new tag value as the prototype writes it: spaces tidied, first letter capital. */
export function tagValue(s: string): string {
  const t = trimmed(s);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
