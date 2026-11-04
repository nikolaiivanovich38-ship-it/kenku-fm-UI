/**
 * Help pages the interface links to. Each opens in the system browser
 * (SEC-10: https only).
 *
 * Lyre's own instructions live in its README on GitHub. Kenku FM's website is
 * linked only where it documents the Kenku FM Stream Deck plugin, which works
 * with Lyre's remote control unchanged.
 */
import identity from "../main/appIdentity.json";

/** README section "Connect your Discord bot": how to create the bot and copy its token. */
export const DISCORD_BOT_HELP_URL = `https://github.com/${identity.github.owner}/${identity.github.repo}#connect-your-discord-bot`;

/** Kenku FM's guide to its Stream Deck plugin ("Kenku Remote"). */
export const STREAM_DECK_PLUGIN_HELP_URL = "https://www.kenku.fm/docs/using-kenku-remote";
