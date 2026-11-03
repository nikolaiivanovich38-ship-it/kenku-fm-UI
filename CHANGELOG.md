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
- Audio files are recognised by their extension too, so files such as .m4a, .flac and .opus are no longer turned away. [BUG-10]

**Security**
- The internal audio link can no longer be reached by other computers on your network. [SEC-2]
- Websites in tabs can no longer use your microphone, camera, location or devices without asking. [SEC-3]
- Tabs only open normal web addresses, and pages can no longer flood the app with pop-up tabs. [SEC-6]
- The app's own windows can no longer be turned into a web page. [SEC-7]
- Only web links (https) are handed to your browser; other kinds of links are refused. [SEC-10]
- Libraries with known security problems were updated (ws, undici, react-router). The remote-control server library (fastify 4) is still to be upgraded; until then its known issues are listed and tracked. [SEC-9]

**Behind the scenes**
- Automated tests for the fixes above, written before each fix. [FND-4]
- Every change is now checked automatically on GitHub: type check, lint, tests with coverage, a dependency security audit, a scan for leaked passwords and CodeQL security analysis. [FND-5]
- Windows installers are built on GitHub and attached to a draft release for review before publishing. [FND-5]
- Release checklist, architecture notes and a developer guide added. [FND-6]
