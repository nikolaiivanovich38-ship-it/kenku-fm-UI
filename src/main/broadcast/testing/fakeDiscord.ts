/**
 * A pretend Discord for tests: bots log in with any token that starts with
 * "fake-", see one server with a few voice channels, and join them without a
 * network. Voice connections record the Opus packets they are given.
 *
 * Unit tests create a `FakeDiscord` each. Test builds started with
 * CUE_DESK_FAKE_DISCORD=1 share one (`sharedFakeDiscord`), which end-to-end
 * tests reach from the main process as `globalThis.__cueDeskFakeDiscord`.
 * Never part of a release build (see discordDriver.ts).
 */
import { EventEmitter } from "events";
import { ChannelType, Events, type Client } from "discord.js";
import {
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import type { DiscordDriver } from "../discordDriver";
import { PROTOTYPE_WORLD } from "./prototypeWorld";

export const FAKE_GUILD_ID = "900";

/** Voice channels of the fake server. */
export const FAKE_CHANNELS = {
  tavern: { id: "901", name: "Tavern", type: ChannelType.GuildVoice },
  dungeon: { id: "902", name: "Dungeon", type: ChannelType.GuildVoice },
  stage: { id: "903", name: "Stage", type: ChannelType.GuildStageVoice },
  /** The bot lacks permission to join. */
  locked: { id: "904", name: "Locked Room", type: ChannelType.GuildVoice, joinable: false },
  /** Joining starts but never completes (BUG-6). */
  silent: { id: "905", name: "Silent Room", type: ChannelType.GuildVoice, neverReady: true },
} as const;

/**
 * OUT-6: a second server, for unit tests that move a bot between servers
 * (`new FakeDiscord({ otherServer: true })`). It is not listed among the
 * bot's servers, so end-to-end tests see the one server as before.
 */
export const FAKE_OTHER_GUILD_ID = "910";
export const FAKE_OTHER_SERVER = {
  hall: { id: "911", name: "Hall", type: ChannelType.GuildVoice, guildId: FAKE_OTHER_GUILD_ID },
} as const;

type ChannelSpec = {
  id: string;
  name: string;
  type: ChannelType;
  joinable?: boolean;
  neverReady?: boolean;
  /** The server the channel is in; the main fake server when missing. */
  guildId?: string;
  /** w4-outputs: the people in the channel (bots are added while they are connected there). */
  members?: string[];
};

/**
 * w4-outputs: the servers, voice channels and people a fake Discord shows, and the Discord name of the bot
 * that logs in with each token. Without one, the fake has its one "Test Server" (FAKE_CHANNELS) and names
 * bots "Fake Bot <n>". The acceptance specs use the prototype's world (testing/prototypeWorld.ts).
 */
export interface FakeWorld {
  guilds: { id: string; name: string; channels: (Omit<ChannelSpec, "type" | "guildId"> & { type?: ChannelType })[] }[];
  /** Bot names by token. A token named here logs in even if it does not start with "fake-" (the specs paste tokens). */
  usernames?: Record<string, string>;
  /**
   * OUT-8: tokens of bots not invited to any server yet: they see no server until Lyre opens an invite (the
   * driver's inviteOpened), as a bot does before someone with Manage Server authorises it.
   */
  notInvited?: string[];
}

const TEST_WORLD: FakeWorld = { guilds: [{ id: FAKE_GUILD_ID, name: "Test Server", channels: Object.values(FAKE_CHANNELS) }] };

/**
 * The parts of a discord.js Collection the app uses. Not a Map subclass: the
 * main bundle is compiled to ES5, where extending Map fails.
 */
class FakeCollection<V> {
  private readonly items: Map<string, V>;
  constructor(entries: [string, V][]) {
    this.items = new Map(entries);
  }
  map<T>(fn: (value: V) => T): T[] {
    return [...this.items.values()].map(fn);
  }
  forEach(fn: (value: V) => void): void {
    this.items.forEach((value) => fn(value));
  }
  get(key: string): V | undefined {
    return this.items.get(key);
  }
}

/** Delay before simulated network events, so they happen asynchronously. */
const TICK_MS = 10;

/** Why a fake connection is Disconnected, as @discordjs/voice reports it. */
export type DisconnectDetails = { reason?: VoiceConnectionDisconnectReason; closeCode?: number };

export class FakeVoiceConnection extends EventEmitter {
  state: {
    status: VoiceConnectionStatus;
    subscription?: { unsubscribe(): void };
    reason?: VoiceConnectionDisconnectReason;
    closeCode?: number;
  } = {
    status: VoiceConnectionStatus.Signalling,
  };
  joinConfig: { channelId: string; guildId: string; group: string };
  /** Opus packets the audio player handed over, with the time they arrived. */
  packets: { at: number; data: Buffer }[] = [];
  destroyed = false;

  constructor(
    private readonly discord: FakeDiscord,
    config: { channelId: string; guildId: string; group: string },
  ) {
    super();
    this.joinConfig = config;
    this.connectSoon();
  }

  get channel(): ChannelSpec | undefined {
    return this.discord.channel(this.joinConfig.channelId);
  }

  private connectSoon() {
    setTimeout(() => {
      if (this.destroyed || this.channel?.neverReady) {
        return;
      }
      if (this.discord.networkDown) {
        // As @discordjs/voice does when it cannot reach the voice server.
        this.setStatus(VoiceConnectionStatus.Disconnected, {
          reason: VoiceConnectionDisconnectReason.WebSocketClose,
          closeCode: 1006,
        });
        return;
      }
      this.setStatus(VoiceConnectionStatus.Connecting);
      this.setStatus(VoiceConnectionStatus.Ready);
    }, TICK_MS);
  }

  setStatus(status: VoiceConnectionStatus, details: DisconnectDetails = {}) {
    const old = this.state;
    // Only a Disconnected state says why.
    const rest = { ...this.state };
    delete rest.reason;
    delete rest.closeCode;
    this.state = { ...rest, status, ...(status === VoiceConnectionStatus.Disconnected ? details : {}) };
    this.emit("stateChange", old, this.state);
    this.emit(status, old, this.state);
  }

  subscribe(player: AudioPlayer) {
    // As VoiceConnection.subscribe does: the player keeps the subscription.
    const subscription = (player as unknown as { subscribe(connection: unknown): { unsubscribe(): void } }).subscribe(this);
    this.state = { ...this.state, subscription };
    return subscription;
  }

  /** Called by PlayerSubscription.unsubscribe, as on a real connection. */
  onSubscriptionRemoved(subscription: unknown) {
    if (this.state.subscription === subscription) {
      this.state = { ...this.state, subscription: undefined };
    }
  }

  /** Called by the real AudioPlayer every 20 ms while playing. */
  prepareAudioPacket(packet: Buffer) {
    this.packets.push({ at: Date.now(), data: packet });
    return packet;
  }

  dispatchAudio() {
    return true;
  }

  setSpeaking() {
    return true;
  }

  rejoin(config?: { channelId?: string }) {
    if (this.destroyed) {
      return false;
    }
    if (config?.channelId) {
      this.joinConfig = { ...this.joinConfig, channelId: config.channelId };
    }
    if (this.discord.gatewayDown) {
      // As @discordjs/voice does when the bot's gateway connection cannot send
      // the join request: Disconnected again, at once, inside rejoin().
      this.setStatus(VoiceConnectionStatus.Disconnected, {
        reason: VoiceConnectionDisconnectReason.AdapterUnavailable,
      });
      return false;
    }
    this.setStatus(VoiceConnectionStatus.Signalling);
    this.connectSoon();
    return true;
  }

  /**
   * Simulate losing the voice connection: by default the network was
   * unplugged; close code 4014 means a moderator moved or kicked the bot.
   */
  disconnect(closeCode = 1006) {
    this.setStatus(VoiceConnectionStatus.Disconnected, {
      reason: VoiceConnectionDisconnectReason.WebSocketClose,
      closeCode,
    });
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.state.subscription?.unsubscribe();
    this.setStatus(VoiceConnectionStatus.Destroyed);
  }
}

export class FakeClient extends EventEmitter {
  user: { id: string; username: string } | null = null;
  destroyed = false;
  readonly token: { value?: string } = {};

  constructor(private readonly discord: FakeDiscord) {
    super();
    discord.clients.push(this);
  }

  async login(token: string) {
    this.token.value = token;
    if (this.discord.networkDown) {
      throw new Error("getaddrinfo ENOTFOUND discord.com");
    }
    if (!token.startsWith("fake-") && !this.discord.usernameFor(token)) {
      throw new Error("An invalid token was provided.");
    }
    const number = this.discord.clients.indexOf(this) + 1;
    this.user = { id: `bot-${number}`, username: this.discord.usernameFor(token) ?? `Fake Bot ${number}` };
    setTimeout(() => {
      if (!this.destroyed) {
        this.emit(Events.ClientReady, this);
      }
    }, TICK_MS);
    return token;
  }

  destroy() {
    this.destroyed = true;
    return Promise.resolve();
  }

  get guilds() {
    const discord = this.discord;
    return {
      fetch: async () =>
        new FakeCollection(discord.guildsFor(this.token.value).map((g): [string, { id: string; fetch: () => Promise<ReturnType<FakeDiscord["guild"]>> }] => [g.id, { id: g.id, fetch: async () => discord.guild(g.id) }])),
    };
  }

  get channels() {
    const discord = this.discord;
    return {
      fetch: async (id: string) => {
        const spec = discord.channel(id);
        if (!spec) {
          throw new Error("Unknown Channel");
        }
        return discord.channelObject(spec);
      },
      /** As discord.js keeps the channels it has seen: what a voice state update reads from. */
      cache: {
        get: (id: string) => {
          const spec = discord.channel(id);
          return spec ? discord.channelObject(spec) : undefined;
        },
      },
    };
  }
}

export class FakeDiscord {
  clients: FakeClient[] = [];
  connections: FakeVoiceConnection[] = [];
  /** While true, logins fail and voice connections cannot (re)connect. */
  networkDown = false;
  /** While true, the bot's gateway connection cannot send a voice join (rejoin fails at once). */
  gatewayDown = false;

  readonly world: FakeWorld;

  constructor(private readonly options: { otherServer?: boolean; world?: FakeWorld } = {}) {
    // A copy, so setMembers changes this fake only.
    const world = options.world ?? TEST_WORLD;
    this.world = {
      usernames: world.usernames,
      notInvited: world.notInvited,
      guilds: world.guilds.map((g) => ({ ...g, channels: g.channels.map((c) => ({ ...c, members: [...(c.members ?? [])] })) })),
    };
  }

  /** OUT-8: an invite was opened: bots not invited so far are now in the servers (the fake cannot tell which). */
  private admitted = false;
  invited(token: string | null | undefined): boolean {
    return this.admitted || !token || !(this.world.notInvited ?? []).includes(token);
  }

  /**
   * The servers a bot with this token is in: all of them, except that a bot the world says was not invited is in
   * none until an invite is opened, and then in the first only (an invite adds a bot to the one server chosen).
   */
  guildsFor(token: string | null | undefined): FakeWorld["guilds"] {
    if (!this.invited(token)) return [];
    return token && (this.world.notInvited ?? []).includes(token) ? this.world.guilds.slice(0, 1) : this.world.guilds;
  }

  /** The Discord name of the bot that logs in with this token, if the world names it. */
  usernameFor(token: string): string | undefined {
    return this.world.usernames?.[token];
  }

  /** w4-outputs: people join or leave a voice channel; every client hears a voice state update, as from Discord. */
  setMembers(channelId: string, members: string[]) {
    for (const guild of this.world.guilds) {
      const channel = guild.channels.find((c) => c.id === channelId);
      if (channel) {
        channel.members = [...members];
      }
    }
    setTimeout(() => {
      for (const client of this.clients) {
        if (!client.destroyed) {
          client.emit(Events.VoiceStateUpdate, {}, {});
        }
      }
    }, TICK_MS);
  }

  readonly driver: DiscordDriver = {
    createClient: () => new FakeClient(this) as unknown as Client,
    inviteOpened: () => {
      this.admitted = true;
    },
    joinVoiceChannel: (options) => {
      const group = options.group ?? "default";
      const existing = this.connections.find(
        (connection) =>
          !connection.destroyed &&
          connection.joinConfig.guildId === options.guildId &&
          connection.joinConfig.group === group,
      );
      if (existing) {
        // Like @discordjs/voice: the same bot moves within a server.
        existing.rejoin({ channelId: options.channelId });
        return existing as unknown as VoiceConnection;
      }
      const connection = new FakeVoiceConnection(this, {
        channelId: options.channelId,
        guildId: options.guildId,
        group,
      });
      this.connections.push(connection);
      return connection as unknown as VoiceConnection;
    },
  };

  channel(id: string): ChannelSpec | undefined {
    const specs: ChannelSpec[] = [
      ...this.world.guilds.flatMap((g) => g.channels.map((c) => ({ type: ChannelType.GuildVoice, ...c, guildId: g.id }))),
      ...(this.options.otherServer ? Object.values(FAKE_OTHER_SERVER) : []),
    ];
    return specs.find((channel) => channel.id === id);
  }

  /** Live connections in a channel. */
  connectionsIn(channelId: string): FakeVoiceConnection[] {
    return this.connections.filter((c) => !c.destroyed && c.joinConfig.channelId === channelId);
  }

  setNetworkDown(down: boolean) {
    this.networkDown = down;
    if (down) {
      for (const connection of this.connections) {
        if (!connection.destroyed) {
          connection.disconnect();
        }
      }
    }
  }

  guild(id: string = this.world.guilds[0].id) {
    const world = this.world.guilds.find((g) => g.id === id) ?? this.world.guilds[0];
    const channels = new FakeCollection(
      world.channels.map((c, position): [string, ReturnType<FakeDiscord["channelObject"]> & { rawPosition: number }] => [
        c.id,
        { ...this.channelObject(this.channel(c.id)!), rawPosition: position },
      ]),
    );
    return {
      id: world.id,
      name: world.name,
      iconURL: (): null => null,
      channels: { fetch: async () => channels },
    };
  }

  channelObject(spec: ChannelSpec) {
    // As discord.js counts members: the people there, and the bots connected there now.
    const bots = this.connectionsIn(spec.id).map((connection) => ({ displayName: `Bot ${connection.joinConfig.group}`, user: { bot: true } }));
    const people = (spec.members ?? []).map((name) => ({ displayName: name, user: { bot: false } }));
    return {
      id: spec.id,
      name: spec.name,
      type: spec.type,
      joinable: spec.joinable ?? true,
      isVoiceBased: () => true,
      members: new FakeCollection([...people, ...bots].map((member, i): [string, typeof member] => [String(i), member])),
      guild: { id: spec.guildId ?? FAKE_GUILD_ID, voiceAdapterCreator: () => ({ sendPayload: () => true, destroy: (): void => undefined }) },
    };
  }

  /**
   * Decode the packets a channel's connection received to 16-bit stereo PCM
   * (e2e checks of what Discord would hear). Uses opusscript, which ships
   * with the app for @discordjs/voice.
   */
  peaks(channelId: string, from = 0): { at: number; peak: number }[] {
    return packetPeaks(this, channelId, from);
  }

  decode(channelId: string): { at: number; pcm: Int16Array }[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpusScript = require("opusscript");
    const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    try {
      return this.connections
        .filter((connection) => connection.joinConfig.channelId === channelId)
        .flatMap((connection) => connection.packets)
        .filter(({ data }) => data.length > 3) // skip Discord's 3-byte silence frames
        .map(({ at, data }) => {
          const pcm: Buffer = decoder.decode(data);
          return { at, pcm: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2) };
        });
    } finally {
      decoder.delete();
    }
  }
}

/** Loudest sample of a decoded packet, 0 to 1. */
function peakOf(pcm: Int16Array): number {
  let peak = 0;
  for (const sample of pcm) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak / 32768;
}

/** Per packet after `from`: arrival time and loudest sample (cheap to send to a test). */
export function packetPeaks(discord: FakeDiscord, channelId: string, from = 0): { at: number; peak: number }[] {
  return discord
    .decode(channelId)
    .slice(from)
    .map(({ at, pcm }) => ({ at, peak: peakOf(pcm) }));
}

let shared: FakeDiscord | undefined;

/** The one fake Discord of a test-build app start; with CUE_DESK_FAKE_DISCORD=prototype, the prototype's world. */
export function sharedFakeDiscord(): FakeDiscord {
  if (!shared) {
    shared = new FakeDiscord(process.env.CUE_DESK_FAKE_DISCORD === "prototype" ? { world: PROTOTYPE_WORLD } : {});
    (globalThis as unknown as { __cueDeskFakeDiscord: FakeDiscord }).__cueDeskFakeDiscord = shared;
  }
  return shared;
}
