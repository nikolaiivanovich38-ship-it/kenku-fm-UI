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
import { REMOTE_CODE_PATTERN, generateRemoteCode } from "./remoteCode";

import type { RemoteSettings } from "../../common/remoteControl";

export type { RemoteSettings };

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
}

export type Checked<T> = T | { error: string };

export function checkRemoteAddress(value: unknown): Checked<{ address: string }> {
  const address = typeof value === "string" ? value.trim() : "";
  if (address.length <= 64 && (address === "localhost" || net.isIP(address) !== 0)) {
    return { address };
  }
  return {
    error:
      "Type this computer's address in numbers: 127.0.0.1 for this computer only, or its network address " +
      "(such as 192.168.1.20) for a Stream Deck or phone on your network.",
  };
}

export function checkRemotePort(value: unknown): Checked<{ port: number }> {
  const port = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : value;
  if (typeof port === "number" && Number.isInteger(port) && port >= MIN_REMOTE_PORT && port <= MAX_REMOTE_PORT) {
    return { port };
  }
  return { error: `Choose a port number from ${MIN_REMOTE_PORT} to ${MAX_REMOTE_PORT}, for example 3333.` };
}

export class RemoteSettingsStore {
  private current: RemoteSettings = { ...DEFAULT_REMOTE_SETTINGS };
  private secret = "";
  private encryptedCode?: string;
  /** True when the code is saved encrypted and survives a restart. */
  readonly codeRemembered: boolean;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly generate: () => string = () => generateRemoteCode(),
  ) {
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

  /** Change some settings. Nothing changes if any value is refused. */
  update(change: Partial<RemoteSettings>): Checked<RemoteSettings> {
    const next = { ...this.current };
    if (change.enabled !== undefined) {
      next.enabled = change.enabled === true;
    }
    if (change.address !== undefined) {
      const address = checkRemoteAddress(change.address);
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
    const address = checkRemoteAddress(data.address);
    const port = checkRemotePort(data.port);
    if (typeof data.enabled === "boolean" && !("error" in address) && !("error" in port)) {
      this.current = { enabled: data.enabled, address: address.address, port: port.port };
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
