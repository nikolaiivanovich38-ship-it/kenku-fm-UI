/**
 * Round 9 §11, built in round 10 (item 47; Nik, 18 Nov 03:14, answer 12.1: A little by default): Settings › Sound to
 * Discord › Dip the music under effects. How far (Off, A little, A lot), Comes back (Quickly, Gently, Slowly) and
 * Ambience dips too, kept on this computer (this page's storage, like the other per-computer choices of a page) and
 * handed to the audio host (setDip), which dips each room's music while an effect that dips plays.
 */
import { useSyncExternalStore } from "react";

import type { DipSettings } from "../../audio/lyreAudio";

export type DipAmount = "off" | "little" | "lot";
export type DipBack = "quick" | "gentle" | "slow";
export interface DipChoice {
  amount: DipAmount;
  back: DipBack;
  ambience: boolean;
}

export const DIP_AMOUNTS: readonly [DipAmount, string][] = [
  ["off", "Off"],
  ["little", "A little"],
  ["lot", "A lot"],
];
export const DIP_BACKS: readonly [DipBack, string][] = [
  ["quick", "Quickly"],
  ["gentle", "Gently"],
  ["slow", "Slowly"],
];
export const DEFAULT_DIP: DipChoice = { amount: "little", back: "gentle", ambience: false };

const DB: Record<DipAmount, number> = { off: 0, little: 6, lot: 12 };
const BACK_SECONDS: Record<DipBack, number> = { quick: 0.5, gentle: 1.5, slow: 3 };

/** The mix the audio host applies: −6 or −12 dB, back over 0.5, 1.5 or 3 s. */
export function dipSettingsOf(choice: DipChoice): DipSettings {
  return { db: DB[choice.amount], backSeconds: BACK_SECONDS[choice.back], ambience: choice.ambience };
}

const KEY = "lyre-dip";
const listeners = new Set<() => void>();
let current: DipChoice = read();

function read(): DipChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DipChoice> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_DIP;
    return {
      amount: DIP_AMOUNTS.some(([v]) => v === raw.amount) ? (raw.amount as DipAmount) : DEFAULT_DIP.amount,
      back: DIP_BACKS.some(([v]) => v === raw.back) ? (raw.back as DipBack) : DEFAULT_DIP.back,
      ambience: typeof raw.ambience === "boolean" ? raw.ambience : DEFAULT_DIP.ambience,
    };
  } catch {
    return DEFAULT_DIP;
  }
}

export function getDip(): DipChoice {
  return current;
}

/** A change from Settings: kept, handed to the audio host, and every screen that shows it hears of it. */
export function setDip(change: Partial<DipChoice>, audio?: { setDip(dip: DipSettings): void }): DipChoice {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  audio?.setDip(dipSettingsOf(current));
  listeners.forEach((listener) => listener());
  return current;
}

/** Back to the choice kept (tests, and a page that starts again). */
export function reloadDip(): void {
  current = read();
  listeners.forEach((listener) => listener());
}

export function useDip(): DipChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getDip,
  );
}
