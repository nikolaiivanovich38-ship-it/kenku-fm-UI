[![CI](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/actions/workflows/ci.yml/badge.svg)](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

<p align="center">
  <img src="./src/assets/brand/wordmark-on-light.svg#gh-light-mode-only" alt="Lyre" height="72">
  <img src="./src/assets/brand/wordmark.svg#gh-dark-mode-only" alt="Lyre" height="72">
</p>

Lyre plays your music and sound effects into a Discord voice channel while you run a tabletop role-playing game. It is built for game masters who score their sessions with film soundtracks: playlists for scenes, soundboards for effects, and websites such as YouTube in tabs.

The name comes from the lyrebird, which copies every sound around it, and from the lyre its tail feathers are shaped like.

Lyre is an **independent fork of [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm)** by Owlbear Rodeo. It is not made or supported by Owlbear Rodeo. Early test versions were called Cue Desk.

<p align="center">
  <img src="./docs/example.png" alt="The Lyre window: bookmarks and outputs on the left, the player with playlists and soundboards on the right" width="738">
</p>

## Install (Windows)

1. Open the [Releases page](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/releases).
2. Under the newest release, download the file ending in **`-win32-x64-setup.exe`**.
3. Run it. The app installs and opens by itself.

The installer is not code-signed yet, so Windows may say **"Windows protected your PC"**. Choose **More info**, then **Run anyway**. Each release lists SHA-256 checksums in `SHA256SUMS.txt` if you want to check the download.

Lyre and Kenku FM can be installed side by side. They use separate data folders.

macOS and Linux: there are no ready-made downloads yet. See [For developers](#for-developers) to build one.

## First start: bringing your library across

The first time Lyre starts, it copies your library from an app you used before: from Cue Desk (Lyre's test versions) if you tried one, otherwise from Kenku FM. That means playlists, soundboards, bookmarks, settings (including your Discord bot token) and the window position. This happens once.

- **Close Cue Desk and Kenku FM before you start Lyre for the first time**, so the library is not being written while it is copied. On Windows, if the app is still open, Lyre says, for example, "Kenku FM is still running. Close it and restart Lyre to bring your library across." Choose **Quit**, close that app, then start Lyre again. (On macOS and Linux Lyre cannot tell whether the other app is open, so close it yourself.)
- If the copy goes wrong, Lyre tells you and offers to quit; the next time it starts, it tries again. If you choose to start with an empty library instead, the old library will not be copied later.
- The other app's files are only read, never changed or deleted. It keeps working as before.
- Your audio files are not copied. Playlists point to the files where they already are, so leave them in place.
- Nothing is copied if Lyre already has a library of its own.

Where the libraries are kept on Windows:

| App | Folder |
| --- | --- |
| Kenku FM | `%APPDATA%\Kenku FM` |
| Cue Desk (test versions) | `%APPDATA%\cue-desk` |
| Lyre | `%APPDATA%\lyre` |

(On macOS: `~/Library/Application Support/`; on Linux: `~/.config/`.)

**If your library did not appear**, and you have not added anything in Lyre yet: close Lyre, paste `%APPDATA%` into the File Explorer address bar, delete the `lyre` folder, close Cue Desk and Kenku FM, then start Lyre again. Once the copy has succeeded (or there was nothing to copy), the result is written to `data-carry-over.json` in the `lyre` folder. It lists folder names only, no personal details; attach it if you report a problem.

## Connect your Discord bot

Lyre joins your voice channel as a Discord bot that you create once, for free.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and sign in. Choose **New Application**, give it a name (for example "Lyre"), and choose **Create**.
2. Open **Bot** in the menu on the left. Choose **Reset Token**, then **Copy**. This is your bot token.
3. Open **OAuth2** in the menu on the left. Under **OAuth2 URL Generator**, tick **bot**; under **Bot Permissions**, tick **View Channels**, **Connect** and **Speak**. Copy the address at the bottom of the page, open it in your browser and add the bot to your server.
4. In Lyre, open **Settings** (the gear icon), paste the token under **Discord**, and choose **Connect**.
5. Choose your voice channel under **Output**.

Treat the token like a password. Anyone who has it can control your bot. If it ever leaks, choose **Reset Token** again and paste the new one into Lyre.

## Updates

On Windows, Lyre checks this project's [Releases](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/releases) every 15 minutes. When an update has downloaded, a message says **"Update Available. Restart to apply."** Lyre never installs updates from Kenku FM. Cue Desk test versions do not update to Lyre: install Lyre once, and it brings their library across. Your version number is shown at the bottom of Settings.

## Known limitations

- Sites that use copy protection (DRM), such as Spotify, do not play in tabs. Upstream Kenku FM is built on a special version of Electron that supports it; Lyre uses the standard version, which receives security updates for longer.
- Cue Desk has no background pictures of its own: Kenku FM's belong to Owlbear Rodeo and are kept in a private repository. If Kenku FM is installed on the same computer, Cue Desk copies its pictures when it starts, and playlists and soundboards brought over from Kenku FM show them as before. Without Kenku FM, backgrounds stay blank until new artwork is added (FND-13). Pictures you add yourself from a file or web address work either way.

## Help

- Something wrong? [Open an issue](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/issues). Please do not contact Owlbear Rodeo about this fork.
- Remote control from a Stream Deck: turn on **Remote** in Lyre's Settings, then use Kenku FM's Stream Deck plugin as its [guide](https://www.kenku.fm/docs/using-kenku-remote) describes. The plugin works with Lyre unchanged.
- What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## For the project owner

- **GitHub Actions must be enabled on the fork**: open the repository's **Actions** tab and confirm. After that, every push is checked (tests, security scans) and the results show on the Actions tab and on pull requests.
- **Making a release**: change `version` in `package.json` (for example `0.1.1`), add the changes to `CHANGELOG.md`, then push a tag with the same number (`v0.1.1`). The Release workflow builds the Windows installer and puts it in a **draft** under **Releases**. Work through [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), then press **Publish release**. Only published releases reach users and automatic updates.

## For developers

Lyre is an [Electron](https://www.electronjs.org/) app written in TypeScript and React, built with [Electron Forge](https://www.electronforge.io/) and [Yarn 1](https://classic.yarnpkg.com/).

```sh
yarn             # install
yarn start       # run in development
yarn check       # type check, lint and all tests
yarn make        # build installers into out/make
```

- [docs/DEVELOPING.md](docs/DEVELOPING.md): set-up, scripts, tests, releases, renaming the app.
- [docs/brand.md](docs/brand.md): the logo, colours and how to rebuild the icons.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app is put together.
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md): what every release must pass.
- [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md): how to propose a change.

## Licence and credits

Lyre is licensed under the GNU General Public License v3.0, the same as Kenku FM. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Kenku FM was created by [Owlbear Rodeo](https://www.owlbear.rodeo). Thank you for building it and releasing it as open source.
