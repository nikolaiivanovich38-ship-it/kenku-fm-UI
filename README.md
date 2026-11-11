[![CI](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/actions/workflows/ci.yml/badge.svg)](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

<p align="center">
  <img src="./src/assets/brand/wordmark-on-light.svg#gh-light-mode-only" alt="Lyre" height="72">
  <img src="./src/assets/brand/wordmark.svg#gh-dark-mode-only" alt="Lyre" height="72">
</p>

Lyre plays your music and sound effects into a Discord voice channel while you run a tabletop role-playing game. It is built for game masters who score their sessions with film soundtracks.

You prepare before the game: add your music to the library, tag it, make playlists and pad boards of sound effects, and plan each session scene by scene. At the table, you run the evening from one screen, Live.

The name comes from the lyrebird, which copies every sound around it, and from the lyre its tail feathers are shaped like.

Lyre is an independent fork of [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) by Owlbear Rodeo. It is not made or supported by Owlbear Rodeo. Early test versions were called Cue Desk.

<p align="center">
  <img src="./docs/example.png" alt="Lyre's Live screen in the light Parchment theme, running Session 14 of the sample campaign The Sunken Crown. On air, at the top, shows the Table room playing a travel montage with wind ambience, and the tracks up next. Below it, Scenes lists the session's scenes with Recap and the coast road playing now and Greyhollow inn next; Current scene shows that scene's playlist and its pads; This session and Whole campaign sit on the right. The menu on the left lists Campaigns, Library, Playlists, Pad boards, Live and Rooms, with Settings, Look and feel and Help at the bottom." width="738">
</p>

## Install (Windows)

1. Open the [Releases page](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/releases).
2. Under the newest release, download the file ending in `-win32-x64-setup.exe`.
3. Run it. The app installs and opens by itself.

The installer is not code-signed yet, so Windows may say "Windows protected your PC". Choose **More info**, then **Run anyway**. Each release lists SHA-256 checksums in `SHA256SUMS.txt` if you want to check the download.

Lyre and Kenku FM can be installed side by side. They use separate data folders.

macOS and Linux: there are no ready-made downloads yet. See [For developers](#for-developers) to build one.

## First start: bringing your library across

The first time Lyre starts, it copies your library from an app you used before: from Cue Desk (Lyre's test versions) if you tried one, otherwise from Kenku FM. That means playlists, soundboards, bookmarks, settings (including your Discord bot token) and the window position. This happens once.

- Close Cue Desk and Kenku FM before you start Lyre for the first time, so the library is not being written while it is copied. On Windows, if the app is still open, Lyre says, for example, "Kenku FM is still running. Close it and restart Lyre to bring your library across." Choose **Quit**, close that app, then start Lyre again. (On macOS and Linux Lyre cannot tell whether the other app is open, so close it yourself.)
- If the copy goes wrong, Lyre tells you and offers to quit; the next time it starts, it tries again. If you choose to start with an empty library instead, the old library will not be copied later.
- The other app's files are only read, never changed or deleted. It keeps working as before.
- Your audio files are not copied. Playlists point to the files where they already are, so leave them in place.
- Nothing is copied if Lyre already has a library of its own.
- The first time Lyre starts, your playlists and soundboards are brought into Lyre's own library. Soundboards become pad boards, and their sounds become pads. Your Discord bot comes across too; if Kenku FM kept its token unprotected, Lyre keeps it encrypted now and Settings says so once. To see what came across, open **Library**, choose **⋯** beside **Add tracks**, then **What came across from Kenku FM**. It lists files Lyre cannot find, with **Find them…**, and your bookmarks, each with **Copy**: websites can't be opened in Lyre for now.
- Background pictures are not brought across: Lyre's screens have none.

Where the libraries are kept on Windows:

| App | Folder |
| --- | --- |
| Kenku FM | `%APPDATA%\Kenku FM` |
| Cue Desk (test versions) | `%APPDATA%\cue-desk` |
| Lyre | `%APPDATA%\lyre` |

(On macOS: `~/Library/Application Support/`; on Linux: `~/.config/`.)

If you used Cue Desk 0.1.1, it may have copied Kenku FM's pictures into a `backgrounds` folder inside the `cue-desk` folder. Lyre does not use that folder; you can delete it.

If your library did not appear, and you have not added anything in Lyre yet: close Lyre, paste `%APPDATA%` into the File Explorer address bar, delete the `lyre` folder, close Cue Desk and Kenku FM, then start Lyre again. Once the copy has succeeded (or there was nothing to copy), the result is written to `data-carry-over.json` in the `lyre` folder. It lists folder names only, no personal details; attach it if you report a problem.

## Find your way around

Lyre opens in one window, where you prepare and run your games. Drag it by the bar at the top; its minimise, maximise and close buttons are at the top right.

The menu on the left:

| In the menu | What it is for |
| --- | --- |
| Campaigns | Your campaigns and their sessions. A session opens in the session planner, where you add scenes and give each one its music, ambience and pad boards. |
| Library | All your tracks. Add files or folders, tag tracks and search them. |
| Playlists | Playlists you put together by hand, and playlists made from tags that keep themselves up to date. |
| Pad boards | Grids of sound effects, each on a pad you press or play with a key. |
| Live | Where you run the evening: On air, the scenes, the current scene, and the session's and campaign's playlists and pads. |
| Rooms | Your bots and the Discord voice channels they are in. Rooms was called Outputs before 0.5.0. |
| Settings | Discord bots, Sound to Discord, Headphones and speakers and Keyboard shortcuts. |
| Look and feel | Colour themes, spacing, text size and high contrast. |
| Help | Short how-to articles you can search. Press `F1` to open it from anywhere. |

**‹** (Back), top left on every screen, goes back through the places you have been. `Ctrl+K` finds and plays any track, playlist, pad or scene.

## Connect your Discord bot

Lyre joins your voice channel as a Discord bot that you create once, for free. Lyre walks you through it.

1. Open **Settings** in the menu. Under Discord bots, choose **Add a bot**. A window with three steps opens.
2. Step 1, Create it: choose **Open the Discord Developer Portal** and sign in. In Discord, choose **New Application**, give it a name, and choose **Create**. Back in Lyre, choose **Next**.
3. Step 2, Invite it: in Discord, open **General Information** and choose **Copy** beside Application ID. Paste it into Lyre, then choose **Open the invite**. Pick your server and choose **Authorize**. You need the Manage Server permission on that server. The invite asks for three permissions: View Channels, Connect and Speak. Back in Lyre, choose **Next**.
4. Step 3, Connect it: in Discord, open **Bot**, choose **Reset Token**, then **Copy**. Discord shows the token only once. Paste it into the Token box in Lyre and choose **Connect**. When Lyre says the bot is connected, choose **Done**.
5. Open **Rooms** in the menu. Your bot says Not in a room. Open its room button, which says **Choose a room…**, and pick your voice channel. Or choose **Add** beside the channel in the list.

You can also make the invite by hand: in step 2, choose **Or make the invite by hand** and follow the steps there. Tick the same three permissions: View Channels, Connect and Speak.

For a second room, such as a side scene or a split party, choose **Add a bot** again and make a second bot.

Treat the token like a password. Anyone who has it can control your bot. Lyre keeps it encrypted on this computer and only ever shows its last four characters. If it ever leaks, choose **Reset Token** again in Discord, then choose **Replace…** beside the token in Lyre's Settings and paste the new one.

## Updates

On Windows, Lyre checks this project's [Releases](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/releases) every 15 minutes. When an update has downloaded, a note at the bottom right says "Lyre has an update. Restart Lyre to use it.", with **Restart now**. If Lyre cannot check for an update or install it, it tells you once, in plain words. The version you have keeps working.

Lyre never installs updates from Kenku FM. Cue Desk test versions do not update to Lyre: install Lyre once, and it brings their library across. Your version number is shown at the top right of Settings and at the foot of Help.

## Known limitations

- Since 0.5.1 there is no old Player tab and no website tabs. Playing YouTube, Spotify and other websites into Discord, and sending a microphone to Discord, may come back in a later release. Keep a portable copy of Lyre 0.4.1 (its zip) if you still need them.
- Remote control and the Stream Deck do not work with Lyre for now. They come back with Lyre's own Stream Deck support in a later release.

## Help

- Something wrong? [Open an issue](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/issues). Please do not contact Owlbear Rodeo about this fork.
- In Lyre, press `F1` for short how-to articles, and a tour you can take again. If you report a problem, Help › **Save diagnostics…** saves a zip file to attach. Your tokens and user name are taken out, and nothing is sent anywhere.
- What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## For the project owner

- GitHub Actions must be enabled on the fork: open the repository's **Actions** tab and confirm. After that, every push is checked (tests, security scans) and the results show on the Actions tab and on pull requests.
- Making a release: change `version` in `package.json` (for example `0.1.1`), add the changes to `CHANGELOG.md`, then push a tag with the same number (`v0.1.1`). The Release workflow builds the Windows installer and puts it in a draft under Releases. Work through [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), then press **Publish release**. Only published releases reach users and automatic updates.

## For developers

Lyre is an [Electron](https://www.electronjs.org/) app written in TypeScript and React, built with [Electron Forge](https://www.electronforge.io/) and [Yarn 1](https://classic.yarnpkg.com/).

```sh
yarn             # install
yarn start       # run in development
yarn check       # type check, lint and all tests
yarn make        # build installers into out/make
```

- [docs/DEVELOPING.md](docs/DEVELOPING.md): getting started, scripts, tests, releases, renaming the app.
- [docs/brand.md](docs/brand.md): the logo, colours and how to rebuild the icons.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app is put together.
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md): what every release must pass.
- [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md): how to propose a change.

## Licence and credits

Lyre is licensed under the GNU General Public License v3.0, the same as Kenku FM. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Kenku FM was created by [Owlbear Rodeo](https://www.owlbear.rodeo). Thank you for building it and releasing it as open source.
