# Changelog

All notable changes to Cue Desk. Versions follow [Semantic Versioning](https://semver.org/). Each entry says what changed for you, in plain language; backlog IDs are in brackets for the team.

## [Unreleased]

### 0.1.0: first release of the fork

**New name and home**
- The app is now called Cue Desk (working name), version 0.1.0. It is an independent fork of Kenku FM 1.5.5 by Owlbear Rodeo and can be installed next to Kenku FM. [FND-1]
- On first start, your Kenku FM library (playlists, soundboards, bookmarks, settings and window position) is copied into Cue Desk. Kenku FM itself is left untouched. [FND-1]
- Help > Learn More opens this project's page instead of Kenku FM's website. [FND-1]
- Automatic updates now come from this project's releases. Before, the app would have replaced itself with upstream Kenku FM. Update problems are now recorded in the log instead of being ignored. [SEC-14]

**Fixes**
- The black "drop the tracks here" overlay no longer gets stuck on screen after a drag. [BUG-1]
- Dropping a big folder imports every file, not just the first 100. [BUG-2]
- A sound's fade-in now works on its own, without also needing a fade-out. [BUG-3]
- Looping sounds with fades no longer use more and more memory during a long session. [BUG-4]
- Jumping to another point in a sound now moves its fade-out too, so it fades out just before the end instead of too early or too late. [BUG-5]
- Stopping a sound with a fade-out always finishes, even when the sound failed to start. [BUG-4]
- The "drop here" overlay no longer flickers while you move a file across the window. [BUG-1]
- Editing a bookmark saves the name and the address together when you press Done; Cancel or Escape leaves the bookmark as it was.
- Error and warning messages stay on screen until you close them; success messages still go away by themselves. Screen readers announce errors straight away and other messages politely.
- Error messages appear at the top of the window, so they no longer cover the Done button in Settings, and screen readers announce them even while Settings is open.
- Buttons shown only as icons (Settings, Back, the "…" options menus) now have names that screen readers read out.
- Dragging a link onto the address bar or a bookmark's address field puts the link in the field.
- Audio files are recognised by their extension too, so files such as .m4a, .flac and .opus are no longer turned away. [BUG-10]
- The remote API's "get" requests (used by Stream Deck buttons) answer correctly when several arrive at once, and the soundboard list is no longer out of date after you edit a soundboard. [PERF-9]
- Closing a tab or switching off an input device frees its audio processing, so long sessions stay lighter. [PERF-5]
- The player and the main window load once at start-up instead of twice.
- The Cue Desk icon shows in the window and taskbar on Linux.

**Security**
- Built on Electron 44 (Chromium 152), which receives security fixes. Kenku FM 1.5.5 uses Electron 37, which no longer does. Sites with copy protection (DRM), such as Spotify, no longer play in tabs; see Known limitations in the README. [SEC-1]
- The app files are packed and checked at start-up, and debugging switches that could let another program take control of the app are turned off. [SEC-13]
- The app's internal messages are accepted only from the app's own pages, and each page loads only the app's own code (Content Security Policy). [SEC-8, SEC-11]
- The hidden window that sends sound to Discord runs in the browser's sandbox. [SEC-12]
- The internal audio link can no longer be reached by other computers on your network. [SEC-2]
- Websites in tabs can no longer use your microphone, camera, location or devices; such requests are refused without asking you. [SEC-3]
- Websites in tabs now keep their logins separately from the app. Logins are not carried over from Kenku FM, so log in to websites in tabs again once. [SEC-3]
- Tabs only open normal web addresses, and pages can no longer flood the app with pop-up tabs. [SEC-6]
- Bookmarks saved without https:// (for example "youtube.com") open again; a bookmark that can't be opened shows a message saying why instead of an empty tab. [SEC-6]
- The address bar shows "Not secure" for http:// pages. [SEC-6]
- The app's own windows can no longer be turned into a web page. [SEC-7]
- Only web links (https) are handed to your browser; other kinds of links are refused. [SEC-10]
- Libraries with known security problems were updated (ws, undici, react-router). The remote-control server library (fastify 4) is still to be upgraded; until then its known issues are listed and tracked. [SEC-9]

**Behind the scenes**
- Automated tests for the fixes above, written before each fix, and end-to-end tests that start the packaged app, including sending a page's sound towards Discord. [FND-4]
- Every change is now checked automatically on GitHub: type check, lint, tests with coverage, a dependency security audit, a scan for leaked passwords and CodeQL security analysis. [FND-5]
- Windows installers are built on GitHub and attached to a draft release for review before publishing. [FND-5]
- Release checklist, architecture notes and a developer guide added. [FND-6]
