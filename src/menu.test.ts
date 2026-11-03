import { beforeAll, describe, expect, it, vi } from "vitest";

type MenuItem = { label?: string; role?: string; submenu?: MenuItem[]; click?: () => unknown };

const electron = vi.hoisted(() => ({
  app: { name: "Cue Desk", isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] as unknown[] },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template), setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

vi.mock("electron", () => ({ ...electron, default: electron }));

beforeAll(async () => {
  await import("./menu");
});

describe("application menu (FND-1)", () => {
  it("'Learn More' opens the fork's README, not upstream's website", async () => {
    const template = electron.Menu.buildFromTemplate.mock.calls[0][0] as MenuItem[];
    const help = template.find((item) => item.role === "help");
    const learnMore = help?.submenu?.find((item) => item.label === "Learn More");
    expect(learnMore).toBeDefined();
    await learnMore?.click?.();
    expect(electron.shell.openExternal).toHaveBeenCalledWith(
      "https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI#readme",
    );
  });
});
