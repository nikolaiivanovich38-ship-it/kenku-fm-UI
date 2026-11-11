/**
 * SEC-4: the remote control's settings, kept by the main process in `remote-control.json` in the data folder.
 *
 * Off until the game master turns it on; when on, it listens on 127.0.0.1 (this computer only) unless an address is
 * chosen. The secret code is created on first run and saved encrypted with safeStorage, like the Discord bot tokens
 * (SEC-5). Where nothing can encrypt it (Linux without a keyring), the code is kept in memory and a new one is made
 * at every start. The file never holds the code as typed.
 */
import fs from "fs";
import net from "net";
import path from "path";

import { canEncrypt, type SafeStorageLike } from "../broadcast/botTokenStore";
import { isPrivateListenAddress, sameForm } from "./homeNetwork";
import { REMOTE_CODE_PATTERN, generateRemoteCode } from "./remoteCode";

import { THIS_COMPUTER_ONLY, type OldRemoteSetting, type RemoteSettings } from "../../common/remoteControl";

export type { OldRemoteSetting, RemoteSettings };

export const DEFAULT_REMOTE_SETTINGS: Readonly<RemoteSettings> = Object.freeze({
  enabled: false,
  address: "127.0.0.1",
  port: 3333,
});

export const MIN_REMOTE_PORT = 1024;
export const MAX_REMOTE_PORT = 65535;

interface StoredFile extends RemoteSettings {
  version: 1;
  /** The secret code encrypted with safeStorage, base64. Absent where it cannot be encrypted. */
  encryptedCode?: string;
  /** Review 0.5.0 CR-3: the main window's old choice was moved in (or there was none to move); never again. */
  oldSettingMoved?: true;
}


export type Checked<T> = T | { error: string };

const NOT_AN_ADDRESS =
  "Type this computer's address in numbers: 127.0.0.1 for this computer only, or its network address " +
  "(such as 192.168.1.20) for a Stream Deck or phone on your network.";

/**
 * CR-2 (review 0.5.0, SEC-4): what is wrong with an address for the remote control to listen on, in plain words, or
 * null when it may. Only 127.0.0.1, or a private address this computer has (`ownAddresses`). With `ownAddresses`
 * null, a private address is not checked against this computer (a saved one, checked again before listening).
 */
export function remoteAddressProblem(address: string, ownAddresses: readonly string[] | null): string | null {
  const plain = sameForm(address);
  if (plain === THIS_COMPUTER_ONLY) return null;
  if (plain.length > 64 || net.isIP(plain) === 0) return NOT_AN_ADDRESS;
  if (/^0\.0\.0\.0$/.test(plain) || /^[0:]+$/.test(plain)) {
    return "Lyre never listens on every address (0.0.0.0 or ::): choose This computer only, or Your home network.";
  }
  if (!isPrivateListenAddress(plain)) {
    return (
      `Lyre does not listen on ${plain}: that is this computer's own loopback or an internet address. Use 127.0.0.1 for ` +
      "this computer only, or Your home network, so nobody outside your home can reach it."
    );
  }
  if (ownAddresses && !ownAddresses.map(sameForm).includes(plain)) {
    return `This computer does not have the address ${plain} now. Choose Your home network again in Settings to use the one it has.`;
  }
  return null;
}

export function checkRemoteAddress(value: unknown, ownAddresses: readonly string[] = []): Checked<{ address: string }> {
  if (typeof value !== "string") return { error: NOT_AN_ADDRESS };
  const problem = remoteAddressProblem(value, ownAddresses);
  return problem ? { error: problem } : { address: sameForm(value) };
}

export function checkRemotePort(value: unknown): Checked<{ port: number }> {
  const port = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : value;
  if (typeof port === "number" && Number.isInteger(port) && port >= MIN_REMOTE_PORT && port <= MAX_REMOTE_PORT) {
    return { port };
  }
  return { error: `Choose a port number from ${MIN_REMOTE_PORT} to ${MAX_REMOTE_PORT}, for example 3333.` };
}

export interface RemoteSettingsStoreOptions {
  /** Tests give their own; the app makes a random code (remoteCode.ts). */
  generate?: () => string;
  /** CR-2: this computer's network addresses, asked each time (ownNetworkAddresses in the app); none: 127.0.0.1 only. */
  ownAddresses?: () => readonly string[];
}

export class RemoteSettingsStore {
  private current: RemoteSettings = { ...DEFAULT_REMOTE_SETTINGS };
  private secret = "";
  private encryptedCode?: string;
  private oldSettingMoved = false;
  /** True when the code is saved encrypted and survives a restart. */
  readonly codeRemembered: boolean;

  private readonly generate: () => string;
  private readonly askOwnAddresses: () => readonly string[];

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
    options: RemoteSettingsStoreOptions = {},
  ) {
    this.generate = options.generate ?? (() => generateRemoteCode());
    this.askOwnAddresses = options.ownAddresses ?? (() => []);
    this.codeRemembered = canEncrypt(safeStorage);
    this.load();
    if (!this.secret) {
      this.replaceCode();
    }
  }

  static fileIn(folder: string): string {
    return path.join(folder, "remote-control.json");
  }

  settings(): RemoteSettings {
    return { ...this.current };
  }

  code(): string {
    return this.secret;
  }

  /** CR-2: this computer's network addresses now, which a home-network address must be one of. */
  ownAddresses(): readonly string[] {
    return this.askOwnAddresses();
  }

  /** Change some settings. Nothing changes if any value is refused. */
  update(change: Partial<RemoteSettings>): Checked<RemoteSettings> {
    const next = { ...this.current };
    if (change.enabled !== undefined) {
      next.enabled = change.enabled === true;
    }
    if (change.address !== undefined) {
      const address = checkRemoteAddress(change.address, this.ownAddresses());
      if ("error" in address) return address;
      next.address = address.address;
    }
    if (change.port !== undefined) {
      const port = checkRemotePort(change.port);
      if ("error" in port) return port;
      next.port = port.port;
    }
    this.current = next;
    this.save();
    return this.settings();
  }

  /**
   * Review 0.5.0 CR-3: the main window's old remote control choice, moved in once. On: it is kept, with 127.0.0.1 for
   * an address that is not allowed and the current port for an odd one. Off: nothing changes. Answers the new
   * settings, or null when nothing changed (off, or already moved).
   */
  moveOldSetting(old: OldRemoteSetting): RemoteSettings | null {
    if (this.oldSettingMoved) return null;
    this.oldSettingMoved = true;
    if (old.enabled === true) {
      const address = checkRemoteAddress(old.address, this.ownAddresses());
      const port = checkRemotePort(old.port);
      this.current = { enabled: true, address: "error" in address ? THIS_COMPUTER_ONLY : address.address, port: "error" in port ? this.current.port : port.port };
    }
    this.save();
    return old.enabled === true ? this.settings() : null;
  }

  /** Make a new secret code; the old one stops working at once. */
  newCode(): string {
    this.replaceCode();
    return this.secret;
  }

  private replaceCode() {
    this.secret = this.generate();
    this.encryptedCode = this.codeRemembered
      ? this.safeStorage.encryptString(this.secret).toString("base64")
      : undefined;
    this.save();
  }

  private load() {
    let data: Partial<StoredFile>;
    try {
      data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<StoredFile>;
    } catch {
      return;
    }
    this.oldSettingMoved = data.oldSettingMoved === true;
    const port = checkRemotePort(data.port);
    if (typeof data.enabled === "boolean" && !("error" in port)) {
      // CR-2: an address of a kind never allowed goes back to 127.0.0.1; a private one is checked before listening.
      const address = typeof data.address === "string" && !remoteAddressProblem(data.address, null) ? sameForm(data.address) : THIS_COMPUTER_ONLY;
      this.current = { enabled: data.enabled, address, port: port.port };
    }
    if (this.codeRemembered && typeof data.encryptedCode === "string") {
      try {
        const secret = this.safeStorage.decryptString(Buffer.from(data.encryptedCode, "base64"));
        // A code in the older 20-symbol form (0.5.0 test builds before the lead's 8-character decision) is replaced.
        if (REMOTE_CODE_PATTERN.test(secret)) {
          this.secret = secret;
          this.encryptedCode = data.encryptedCode;
        }
      } catch {
        // Saved by another user account or computer: a new code is made.
        this.secret = "";
      }
    }
  }

  private save() {
    const data: StoredFile = {
      version: 1,
      ...this.current,
      ...(this.encryptedCode ? { encryptedCode: this.encryptedCode } : {}),
      ...(this.oldSettingMoved ? { oldSettingMoved: true as const } : {}),
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      // As botTokenStore: a fresh temporary file, so its owner-only mode is set when it is created.
      fs.rmSync(temporary, { force: true });
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      console.error("Unable to save the remote control settings", error);
    }
  }
}
