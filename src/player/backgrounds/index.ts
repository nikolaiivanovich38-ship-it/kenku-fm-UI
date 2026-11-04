/**
 * The player's built-in background pictures, by name.
 *
 * Playlists and soundboards store a background either as one of these names
 * ("tavern") or as an address of their own (a file or web address). The names
 * are Kenku FM's 23; the pictures are Cue Desk's own, painted by
 * scripts/backgrounds and bundled into the app from this folder, so they show
 * without Kenku FM installed and libraries brought over from Kenku FM keep a
 * picture without any change to their data.
 */
import blank from "../../assets/blank.png";
import { backgroundsFrom, randomBackgroundFrom, type ImageContext } from "./backgroundList";

// Every picture in this folder, bundled at build time.
// @ts-expect-error require.context is provided by webpack at build time
const images: ImageContext = require.context("./", false, /\.(png|jpe?g|svg|webp)$/);

export const backgrounds: Record<string, string> = backgroundsFrom(images, blank);

export type Background = keyof typeof backgrounds;

/** A random picture for a new playlist or soundboard; blank only when there is nothing else. */
export function getRandomBackground(): Background {
  return randomBackgroundFrom(backgrounds);
}

export function isBackground(background: string): background is Background {
  return Object.prototype.hasOwnProperty.call(backgrounds, background);
}
