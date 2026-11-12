/**
 * PLY-5, D4: the engine's mixing desk, as a Web Audio graph.
 *
 *   music ───┐
 *   ambience ┼─> master ─> table output     (what the main Discord room hears)
 *   effects ─┘
 *   whisper ──────────────> whisper output   (a private mix for a second room, OUT-5)
 *   preview ──────────────> preview output   (the GM's headphones only, PRV-1)
 *
 * Each bus is one gain node whose gain is its level, or 0 when muted, so
 * muting keeps the level. Master scales the table mix only. The three outputs
 * are separate unity-gain nodes that this class never connects anywhere: the
 * host decides where each one goes (see docs/playback-engine.md), so the
 * capture side can take the table and whisper mixes as separate streams and
 * the preview can never leak into a broadcast by accident.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import { EngineContext, GainLike, rampTo } from "../audio/types";

export const BUS_IDS = ["music", "ambience", "effects", "whisper", "preview"] as const;
export type BusId = (typeof BUS_IDS)[number];

/** Buses mixed into the table output through the master. */
export const TABLE_BUSES: readonly BusId[] = ["music", "ambience", "effects"];

export const OUTPUT_IDS = ["table", "whisper", "preview"] as const;
export type OutputId = (typeof OUTPUT_IDS)[number];

export type FaderId = BusId | "master";
export type FaderState = { level: number; muted: boolean };
export type MixerLevels = Record<FaderId, FaderState>;

/** Fader moves are smoothed this much so they do not click. */
const SMOOTHING_SECONDS = 0.02;

interface MixerEvents {
  change: (levels: MixerLevels) => void;
}

export class Mixer extends TypedEmitter<MixerEvents> {
  readonly outputs: Readonly<Record<OutputId, GainLike>>;
  private readonly faders = new Map<FaderId, { node: GainLike; state: FaderState }>();
  private readonly nodes: GainLike[] = [];

  constructor(private readonly context: EngineContext) {
    super();
    const gain = () => {
      const node = context.createGain();
      this.nodes.push(node);
      return node;
    };
    this.outputs = { table: gain(), whisper: gain(), preview: gain() };

    const master = gain();
    master.connect(this.outputs.table);
    this.faders.set("master", { node: master, state: { level: 1, muted: false } });

    for (const bus of BUS_IDS) {
      const node = gain();
      node.connect(TABLE_BUSES.includes(bus) ? master : this.outputs[bus as "whisper" | "preview"]);
      this.faders.set(bus, { node, state: { level: 1, muted: false } });
    }
  }

  /** Where a voice on `bus` connects. */
  input(bus: BusId): GainLike {
    return this.fader(bus).node;
  }

  setLevel(id: FaderId, level: number): void {
    if (!Number.isFinite(level)) {
      throw new Error(`Fader level must be a number, got ${level}`);
    }
    this.update(id, { ...this.fader(id).state, level: Math.max(0, Math.min(1, level)) });
  }

  setMuted(id: FaderId, muted: boolean): void {
    this.update(id, { ...this.fader(id).state, muted });
  }

  levels(): MixerLevels {
    const levels = {} as MixerLevels;
    for (const [id, { state }] of this.faders) {
      levels[id] = { ...state };
    }
    return levels;
  }

  /** Bring back levels saved with `levels()`; faders missing from `saved` stay as they are. */
  restore(saved: Partial<MixerLevels>): void {
    for (const [id, state] of Object.entries(saved) as [FaderId, FaderState][]) {
      if (this.faders.has(id) && state) {
        this.setLevel(id, state.level);
        this.setMuted(id, state.muted);
      }
    }
  }

  dispose(): void {
    for (const node of this.nodes) {
      node.disconnect();
    }
    this.removeAllListeners();
  }

  private fader(id: FaderId) {
    const fader = this.faders.get(id);
    if (!fader) {
      throw new Error(`Unknown fader: ${id}`);
    }
    return fader;
  }

  private update(id: FaderId, state: FaderState) {
    const fader = this.fader(id);
    fader.state = state;
    rampTo(fader.node.gain, state.muted ? 0 : state.level, this.context.currentTime, SMOOTHING_SECONDS);
    this.emit("change", this.levels());
  }
}
