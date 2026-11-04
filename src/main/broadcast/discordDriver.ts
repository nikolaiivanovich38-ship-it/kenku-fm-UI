import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, type VoiceConnection } from "@discordjs/voice";

/** True only in packages built with CUE_DESK_E2E_BUILD=1 (webpack.main.config.js). */
declare const __CUE_DESK_TEST_BUILD__: boolean;

/**
 * Everything the outputs need from Discord, so tests can swap in a fake:
 * unit tests always, end-to-end tests of a test build with
 * CUE_DESK_FAKE_DISCORD=1 (Discord cannot be reached from the test machine).
 */
export interface DiscordDriver {
  createClient(): Client;
  joinVoiceChannel(options: Parameters<typeof joinVoiceChannel>[0]): VoiceConnection;
}

export const realDiscordDriver: DiscordDriver = {
  createClient: () =>
    new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    }),
  joinVoiceChannel,
};

/** Whether this start may use the fake Discord (test builds only). */
export function wantsFakeDiscord(env: NodeJS.ProcessEnv, testBuild: boolean): boolean {
  return testBuild && env.CUE_DESK_FAKE_DISCORD === "1";
}

/** The driver for this app start. Release builds compile the fake out. */
export function defaultDiscordDriver(): DiscordDriver {
  if (
    typeof __CUE_DESK_TEST_BUILD__ !== "undefined" &&
    __CUE_DESK_TEST_BUILD__ &&
    wantsFakeDiscord(process.env, __CUE_DESK_TEST_BUILD__)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sharedFakeDiscord } = require("./testing/fakeDiscord") as typeof import("./testing/fakeDiscord");
    return sharedFakeDiscord().driver;
  }
  return realDiscordDriver;
}
