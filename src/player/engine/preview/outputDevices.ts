/**
 * PRV-2: which sound device the preview plays on, and which one the local
 * monitor ("This Computer") plays on.
 *
 * - The choice is remembered between runs (`storageChoiceStore`), with the
 *   device's name, so a message can name it when it is missing.
 * - When the chosen device is not connected, or refuses, sound goes to the
 *   default device and the status carries a plain message saying so. The
 *   choice is kept: when the device is plugged in again, it is used again.
 * - Anything with `setSinkId` can be a target: an AudioContext
 *   (previewOutput.ts) or an <audio> element (the monitor).
 *
 * Device names are only given to a page allowed to use audio devices (the
 * `media` permission); without it the list has no names, and the page that
 * shows the choice must be one that has it (see docs/ARCHITECTURE.md).
 */
import { TypedEmitter } from "tiny-typed-emitter";

export type OutputRole = "preview" | "monitor";

export interface OutputDeviceInfo {
  /** "" is the default device. */
  deviceId: string;
  label: string;
}

export interface DeviceSource {
  /** Every audio output device. */
  list(): Promise<OutputDeviceInfo[]>;
  /** Devices plugged in or out. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface SinkTarget {
  setSinkId(deviceId: string): Promise<void>;
}

type Choices = Partial<Record<OutputRole, OutputDeviceInfo>>;

export interface ChoiceStore {
  load(): Choices;
  save(choices: Choices): void;
}

export interface DeviceStatus {
  /** The device sound goes to now ("" for the default). */
  deviceId: string;
  label: string;
  /** Why it is not the chosen device, in plain words; null when all is as chosen. */
  message: string | null;
}

export const DEFAULT_DEVICE: OutputDeviceInfo = { deviceId: "", label: "Default sound device" };

/** Chromium's stand-ins for the default devices, which repeat a real device. */
const PSEUDO_DEVICES = new Set(["default", "communications"]);

/** What each use is called in a message. */
const WHAT_PLAYS: Record<OutputRole, string> = {
  preview: "the preview",
  monitor: "what you hear on this computer",
};

const STORAGE_KEY = "lyre.outputDevices";

/** Choices saved in localStorage. Storage that cannot be read or written only means the choice is not remembered. */
export function storageChoiceStore(storage: Pick<Storage, "getItem" | "setItem">, key = STORAGE_KEY): ChoiceStore {
  return {
    load: () => {
      try {
        const saved: unknown = JSON.parse(storage.getItem(key) ?? "{}");
        const choices: Choices = {};
        for (const role of Object.keys(WHAT_PLAYS) as OutputRole[]) {
          const choice = (saved as Record<string, unknown> | null)?.[role] as Partial<OutputDeviceInfo> | undefined;
          if (choice && typeof choice.deviceId === "string" && choice.deviceId !== "" && typeof choice.label === "string") {
            choices[role] = { deviceId: choice.deviceId, label: choice.label };
          }
        }
        return choices;
      } catch {
        return {};
      }
    },
    save: (choices) => {
      try {
        storage.setItem(key, JSON.stringify(choices));
      } catch {
        // Not remembered for the next run; this run still uses the choice.
      }
    },
  };
}

/** The browser's audio output devices (`navigator.mediaDevices`). */
export function browserDeviceSource(mediaDevices: MediaDevices = navigator.mediaDevices): DeviceSource {
  return {
    list: async () =>
      (await mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "audiooutput")
        .map((device) => ({ deviceId: device.deviceId, label: device.label })),
    onChange: (listener) => {
      mediaDevices.addEventListener("devicechange", listener);
      return () => mediaDevices.removeEventListener("devicechange", listener);
    },
  };
}

interface ChooserEvents {
  /** The device a use plays on, or its message, changed. */
  status: (role: OutputRole, status: DeviceStatus) => void;
}

export class OutputDeviceChooser extends TypedEmitter<ChooserEvents> {
  private readonly devices: DeviceSource;
  private readonly store: ChoiceStore;
  private choices: Choices;
  private readonly targets = new Map<OutputRole, SinkTarget>();
  private readonly statuses = new Map<OutputRole, DeviceStatus>();
  /** Device changes are applied one at a time, in order. */
  private applying: Promise<unknown> = Promise.resolve();
  private readonly unsubscribe: () => void;

  constructor(options: { devices: DeviceSource; store: ChoiceStore }) {
    super();
    this.devices = options.devices;
    this.store = options.store;
    this.choices = this.store.load();
    this.unsubscribe = this.devices.onChange(() => {
      for (const role of this.targets.keys()) {
        void this.apply(role);
      }
    });
  }

  /** The devices to choose from: the default first, then each device, unnamed ones numbered. */
  async list(): Promise<OutputDeviceInfo[]> {
    const real = (await this.devices.list()).filter((device) => device.deviceId !== "" && !PSEUDO_DEVICES.has(device.deviceId));
    return [DEFAULT_DEVICE, ...real.map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Sound device ${index + 1}` }))];
  }

  /** Play `role` on `target`, on the remembered device. */
  attach(role: OutputRole, target: SinkTarget): Promise<DeviceStatus> {
    this.targets.set(role, target);
    return this.apply(role, true);
  }

  /** Choose and remember a device ("" for the default) for `role`. */
  async choose(role: OutputRole, deviceId: string): Promise<DeviceStatus> {
    if (deviceId === "") {
      delete this.choices[role];
    } else {
      const device = (await this.list()).find((d) => d.deviceId === deviceId);
      if (!device) {
        throw new Error("That sound device is not connected.");
      }
      this.choices[role] = device;
    }
    this.store.save(this.choices);
    return this.apply(role, true);
  }

  status(role: OutputRole): DeviceStatus | undefined {
    return this.statuses.get(role);
  }

  dispose(): void {
    this.unsubscribe();
    this.targets.clear();
    this.removeAllListeners();
  }

  private apply(role: OutputRole, force = false): Promise<DeviceStatus> {
    const run = this.applying.then(() => this.applyNow(role, force));
    this.applying = run.catch((): undefined => undefined);
    return run;
  }

  private async applyNow(role: OutputRole, force: boolean): Promise<DeviceStatus> {
    const choice = this.choices[role];
    const listed = choice ? (await this.list()).find((d) => d.deviceId === choice.deviceId) : undefined;
    let status: DeviceStatus;
    if (!choice) {
      status = { ...DEFAULT_DEVICE, message: null };
    } else if (listed) {
      status = { ...listed, message: null };
    } else {
      status = { ...DEFAULT_DEVICE, message: `${choice.label || "The chosen sound device"} is not connected, so ${WHAT_PLAYS[role]} plays on the default sound device.` };
    }
    const target = this.targets.get(role);
    const previous = this.statuses.get(role);
    if (target && (force || previous?.deviceId !== status.deviceId)) {
      try {
        await target.setSinkId(status.deviceId);
      } catch {
        await target.setSinkId("").catch((): undefined => undefined);
        status = { ...DEFAULT_DEVICE, message: `${status.label} could not be used, so ${WHAT_PLAYS[role]} plays on the default sound device.` };
      }
    }
    if (target) {
      this.statuses.set(role, status);
      if (previous?.deviceId !== status.deviceId || previous?.message !== status.message) {
        this.emit("status", role, status);
      }
    }
    return status;
  }
}
