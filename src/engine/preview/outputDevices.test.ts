import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChoiceStore,
  DeviceSource,
  OutputDeviceChooser,
  OutputDeviceInfo,
  SinkTarget,
  storageChoiceStore,
} from "./outputDevices";

let devices: OutputDeviceInfo[];
let changeListeners: (() => void)[];
let saved: Map<string, string>;

const deviceSource: DeviceSource = {
  list: async () => devices,
  onChange: (listener) => {
    changeListeners.push(listener);
    return () => changeListeners.splice(changeListeners.indexOf(listener), 1);
  },
};

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  return { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => void saved.set(key, value) };
}

function sink(fail: (id: string) => boolean = () => false) {
  const ids: string[] = [];
  const target: SinkTarget = {
    setSinkId: vi.fn(async (id: string) => {
      if (fail(id)) throw new Error("NotFoundError: Requested device not found");
      ids.push(id);
    }),
  };
  return { target, ids };
}

const chooser = (store: ChoiceStore = storageChoiceStore(memoryStorage())) => new OutputDeviceChooser({ devices: deviceSource, store });
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  devices = [
    { deviceId: "default", label: "Default - Speakers (Realtek)" },
    { deviceId: "spk", label: "Speakers (Realtek)" },
    { deviceId: "hp", label: "Headset (USB)" },
    { deviceId: "x", label: "" },
  ];
  changeListeners = [];
  saved = new Map();
});

describe("OutputDeviceChooser (PRV-2): where preview and monitoring play", () => {
  it("lists the default device first, then each device by name (unnamed ones numbered)", async () => {
    expect(await chooser().list()).toEqual([
      { deviceId: "", label: "Default sound device" },
      { deviceId: "spk", label: "Speakers (Realtek)" },
      { deviceId: "hp", label: "Headset (USB)" },
      { deviceId: "x", label: "Sound device 3" },
    ]);
  });

  it("plays on the chosen device and remembers it for the next start, per use", async () => {
    const first = chooser();
    const preview = sink();
    const monitor = sink();
    await first.attach("preview", preview.target);
    await first.attach("monitor", monitor.target);
    expect(await first.choose("preview", "hp")).toEqual({ deviceId: "hp", label: "Headset (USB)", message: null });
    expect(preview.ids).toEqual(["", "hp"]);
    expect(monitor.ids).toEqual([""]);

    const nextRun = chooser();
    const again = sink();
    expect(await nextRun.attach("preview", again.target)).toEqual({ deviceId: "hp", label: "Headset (USB)", message: null });
    expect(again.ids).toEqual(["hp"]);
  });

  it("falls back to the default device with a plain message when the chosen one is gone, and keeps the choice", async () => {
    await chooser().choose("preview", "hp");
    devices = devices.filter((d) => d.deviceId !== "hp");
    const preview = sink();
    const status = await chooser().attach("preview", preview.target);
    expect(preview.ids).toEqual([""]);
    expect(status).toEqual({
      deviceId: "",
      label: "Default sound device",
      message: "Headset (USB) is not connected, so the preview plays on the default sound device.",
    });
    expect(JSON.parse(saved.get("lyre.outputDevices")!).preview.deviceId).toBe("hp");
  });

  it("switches back by itself when the chosen device is plugged in again", async () => {
    const c = chooser();
    const preview = sink();
    await c.attach("preview", preview.target);
    await c.choose("preview", "hp");
    const statuses: (string | null)[] = [];
    c.on("status", (role, status) => statuses.push(`${role}:${status.deviceId}:${status.message ?? ""}`));
    devices = devices.filter((d) => d.deviceId !== "hp");
    changeListeners.forEach((l) => l());
    await settle();
    devices.push({ deviceId: "hp", label: "Headset (USB)" });
    changeListeners.forEach((l) => l());
    await settle();
    expect(preview.ids).toEqual(["", "hp", "", "hp"]);
    expect(statuses).toEqual([
      "preview::Headset (USB) is not connected, so the preview plays on the default sound device.",
      "preview:hp:",
    ]);
  });

  it("falls back to the default device when the device refuses, saying so", async () => {
    const c = chooser();
    const monitor = sink((id) => id === "spk");
    await c.attach("monitor", monitor.target);
    const status = await c.choose("monitor", "spk");
    expect(monitor.ids).toEqual(["", ""]);
    expect(status.message).toBe("Speakers (Realtek) could not be used, so what you hear on this computer plays on the default sound device.");
  });

  it("choosing the default device forgets the choice", async () => {
    const c = chooser();
    await c.choose("preview", "hp");
    expect(await c.choose("preview", "")).toEqual({ deviceId: "", label: "Default sound device", message: null });
    expect(JSON.parse(saved.get("lyre.outputDevices")!).preview).toBeUndefined();
  });

  it("refuses a device that is not listed", async () => {
    await expect(chooser().choose("preview", "nope")).rejects.toThrow("That sound device is not connected.");
  });

  it("still plays when the saved choices cannot be read or written", async () => {
    const broken = storageChoiceStore({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const c = chooser(broken);
    const preview = sink();
    await c.attach("preview", preview.target);
    expect((await c.choose("preview", "hp")).deviceId).toBe("hp");
    expect(preview.ids).toEqual(["", "hp"]);
  });

  it("ignores saved choices in a shape it does not know", async () => {
    saved.set("lyre.outputDevices", '{"preview": 5, "monitor": {"deviceId": 3}}');
    const preview = sink();
    expect((await chooser().attach("preview", preview.target)).deviceId).toBe("");
  });

  it("dispose() stops listening for devices being plugged in", () => {
    const c = chooser();
    expect(changeListeners).toHaveLength(1);
    c.dispose();
    expect(changeListeners).toHaveLength(0);
  });
});
