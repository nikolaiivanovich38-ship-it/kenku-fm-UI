import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/** The parts of Electron's `safeStorage` the store uses. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  /** Linux only: which keyring encrypts the data. */
  getSelectedStorageBackend?(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** What the interface may know about a bot: never its token. */
export interface BotSummary {
  id: string;
  /** Saved name, e.g. "Bot 1"; the Discord name is shown once connected. */
  name: string;
  hasToken: boolean;
  /** True when the token is saved encrypted; false when kept for this session only. */
  tokenRemembered: boolean;
  /** OUT-8: the last four characters of the token (Settings shows "••••••••Kq7w"), or null. Never more of it. */
  tokenEnd: string | null;
  /** OUT-8: the bot's Application ID, for its invite link; null when not given. */
  applicationId: string | null;
}

interface StoredBot {
  id: string;
  name: string;
  /** Token encrypted with safeStorage, base64. Never plain text. */
  encryptedToken?: string;
  /** OUT-8: the Application ID (a Discord id, digits only), for the invite link. Not a secret. */
  applicationId?: string;
}

/**
 * A bot taken out by Remove, kept in memory until its Undo is gone, to put it back as it was: its place, name,
 * Application ID and encrypted token. A token kept for this session only is held outside the object (so it is never
 * part of anything written or sent).
 */
export interface RemovedBot {
  readonly id: string;
  readonly index: number;
  readonly bot: Readonly<StoredBot>;
}
const SESSION_TOKENS = new WeakMap<RemovedBot, string>();

interface StoredFile {
  version: 1;
  bots: StoredBot[];
}

/** Bot ids are generated here; the interface may only send them back. */
export const BOT_ID_PATTERN = /^bot-[0-9a-f-]{36}$/;

/**
 * Whether tokens can be saved encrypted. On Linux without a keyring,
 * Electron falls back to "basic_text", which encrypts with a fixed,
 * publicly known key: that is plain text in disguise, so it counts as
 * unavailable and tokens are kept in memory only.
 */
export function canEncrypt(safeStorage: SafeStorageLike): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    return false;
  }
  const backend = safeStorage.getSelectedStorageBackend?.();
  return backend === undefined || (backend !== "basic_text" && backend !== "unknown");
}

/** Test builds only: CUE_DESK_FAKE_KEYRING=1 saves tokens with testing/fakeKeyring.ts (a test machine has no keyring). */
export function wantsFakeKeyring(env: NodeJS.ProcessEnv, testBuild: boolean): boolean {
  return testBuild && env.CUE_DESK_FAKE_KEYRING === "1";
}

/**
 * SEC-5: Discord bot tokens, one per bot, kept in the main process.
 *
 * Tokens are encrypted with Electron's safeStorage (Windows DPAPI, macOS
 * Keychain, Linux Secret Service/KWallet) and saved in `discord-bots.json`
 * in the data folder. When encryption is unavailable a token is kept in
 * memory for this session only and never written. The interface can learn
 * whether a bot has a token, set a new one or remove it, but cannot read it.
 */
export class BotTokenStore {
  private bots: StoredBot[] = [];
  /** Tokens for this session only (no encryption available). */
  private sessionTokens = new Map<string, string>();
  /** OUT-8: each token's last four characters, worked out once (decrypting on every state would cost each time). */
  private tokenEnds = new Map<string, string | null>();
  readonly encryption: boolean;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
  ) {
    this.encryption = canEncrypt(safeStorage);
    this.load();
  }

  static fileIn(folder: string): string {
    return path.join(folder, "discord-bots.json");
  }

  list(): BotSummary[] {
    return this.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      hasToken: Boolean(bot.encryptedToken) || this.sessionTokens.has(bot.id),
      tokenRemembered: Boolean(bot.encryptedToken),
      tokenEnd: this.tokenEnd(bot.id),
      applicationId: bot.applicationId ?? null,
    }));
  }

  /** OUT-8: Rename. False for an unknown bot or a blank name. */
  rename(id: string, name: string): boolean {
    const bot = this.bots.find((candidate) => candidate.id === id);
    const clean = typeof name === "string" ? name.trim().slice(0, 100) : "";
    if (!bot || !clean) return false;
    bot.name = clean;
    this.save();
    return true;
  }

  /** OUT-8: the bot's Application ID (null: none), for its invite link. The caller checks its shape. */
  setApplicationId(id: string, applicationId: string | null): void {
    const bot = this.bots.find((candidate) => candidate.id === id);
    if (!bot) return;
    if (applicationId) bot.applicationId = applicationId;
    else delete bot.applicationId;
    this.save();
  }

  /** OUT-8 Remove: takes the bot out and answers what putBack needs to undo it; null for an unknown bot. */
  takeOut(id: string): RemovedBot | null {
    const index = this.bots.findIndex((bot) => bot.id === id);
    if (index < 0) return null;
    const removed: RemovedBot = { id, index, bot: { ...this.bots[index] } };
    const session = this.sessionTokens.get(id);
    if (session) SESSION_TOKENS.set(removed, session);
    this.removeBot(id);
    return removed;
  }

  /** OUT-8 Remove's Undo: the bot comes back where it was, with its name, Application ID and token. */
  putBack(removed: RemovedBot): void {
    if (this.has(removed.id)) return;
    this.bots.splice(Math.min(removed.index, this.bots.length), 0, { ...removed.bot });
    const session = SESSION_TOKENS.get(removed);
    if (session) this.sessionTokens.set(removed.id, session);
    this.tokenEnds.delete(removed.id);
    this.save();
  }

  private tokenEnd(id: string): string | null {
    if (!this.tokenEnds.has(id)) this.tokenEnds.set(id, this.token(id)?.slice(-4) ?? null);
    return this.tokenEnds.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.bots.some((bot) => bot.id === id);
  }

  /** Add a bot without a token; returns its id. */
  addBot(): string {
    const id = `bot-${randomUUID()}`;
    this.bots.push({ id, name: this.nextName() });
    this.save();
    return id;
  }

  removeBot(id: string): void {
    this.bots = this.bots.filter((bot) => bot.id !== id);
    this.sessionTokens.delete(id);
    this.tokenEnds.delete(id);
    this.save();
  }

  /**
   * Store a bot's token, replacing any earlier one. Returns whether it is
   * remembered after a restart: encrypted and written to disk (false: kept
   * for this session only, or the file could not be written).
   */
  setToken(id: string, token: string): boolean {
    const bot = this.bots.find((candidate) => candidate.id === id);
    if (!bot) {
      return false;
    }
    this.tokenEnds.delete(id);
    if (this.encryption) {
      bot.encryptedToken = this.safeStorage.encryptString(token).toString("base64");
      this.sessionTokens.delete(id);
    } else {
      delete bot.encryptedToken;
      this.sessionTokens.set(id, token);
    }
    const written = this.save();
    return Boolean(bot.encryptedToken) && written;
  }

  removeToken(id: string): void {
    const bot = this.bots.find((candidate) => candidate.id === id);
    if (bot) {
      delete bot.encryptedToken;
    }
    this.sessionTokens.delete(id);
    this.tokenEnds.delete(id);
    this.save();
  }

  /** The token, for logging the bot in. Main process only. */
  token(id: string): string | undefined {
    const session = this.sessionTokens.get(id);
    if (session) {
      return session;
    }
    const bot = this.bots.find((candidate) => candidate.id === id);
    if (!bot?.encryptedToken || !this.encryption) {
      return undefined;
    }
    try {
      return this.safeStorage.decryptString(Buffer.from(bot.encryptedToken, "base64"));
    } catch (error) {
      // Saved by another user account or machine: it cannot be used here.
      console.error("Unable to read a saved Discord bot token", error);
      return undefined;
    }
  }

  private nextName(): string {
    const used = new Set(this.bots.map((bot) => bot.name));
    let number = 1;
    while (used.has(`Bot ${number}`)) {
      number++;
    }
    return `Bot ${number}`;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    try {
      const data = JSON.parse(raw) as Partial<StoredFile>;
      this.bots = (Array.isArray(data.bots) ? data.bots : [])
        .filter((bot): bot is StoredBot => typeof bot?.id === "string" && BOT_ID_PATTERN.test(bot.id))
        .map((bot) => ({
          id: bot.id,
          name: typeof bot.name === "string" ? bot.name.slice(0, 100) : "Bot",
          ...(typeof bot.encryptedToken === "string" ? { encryptedToken: bot.encryptedToken } : {}),
          ...(typeof bot.applicationId === "string" && /^\d{15,22}$/.test(bot.applicationId) ? { applicationId: bot.applicationId } : {}),
        }));
    } catch (error) {
      console.error("Unable to read the Discord bot list", error);
    }
  }

  /** Writes the list; false when it could not be written. */
  private save(): boolean {
    const data: StoredFile = { version: 1, bots: this.bots };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      // WP1 review 11: a file's mode is set only when it is created, so a
      // temporary file left by an interrupted save is removed and the new one
      // created afresh ("wx": fails rather than reuse a file that appears meanwhile).
      fs.rmSync(temporary, { force: true });
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.filePath);
      return true;
    } catch (error) {
      console.error("Unable to save the Discord bot list", error);
      return false;
    }
  }
}
