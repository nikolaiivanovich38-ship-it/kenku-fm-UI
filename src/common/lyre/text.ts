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

/**
 * Item 51 (Nik, 14 Nov: a track was 10:00 in the list and 9:59 in Now playing): every length and time on screen is
 * written by this one helper, with one rule: whole seconds, rounded to the nearest; "m:ss", or "h:mm:ss" from an hour.
 */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
/** A length in milliseconds, by the same rule (clockTime). */
export const lengthText = (ms: number): string => clockTime(ms / 1000);
