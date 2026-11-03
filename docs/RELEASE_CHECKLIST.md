# Release checklist (Definition of Done)

Copy this list into the release pull request or draft release and tick every item. A release is not published until every box is ticked, or an unticked box has a written reason the product owner accepted.

Release: `vX.Y.Z` · Date: ____ · Checked by: ____

## Quality

- [ ] CI is green on the release commit: type check, lint, tests, script tests, dependency audit, secret scan, CodeQL.
- [ ] Every fix or feature in this release has tests, written before the code (the test failed first).
- [ ] No new lint warnings in changed files.

## Security

- [ ] Changed areas reviewed against [docs/security.md](security.md) (permissions, navigation, IPC, links, network listeners, stored secrets).
- [ ] `scripts/audit-allowlist.json` reviewed: each entry still needed, its backlog item still planned, `reviewed` date updated. Stale entries removed.
- [ ] Audit allowlist expiry dates reviewed: no `reviewBy` date falls before the next planned release (the gate fails once one passes). For each entry near its date, either the backlog item (for example the Electron upgrade, SEC-1) is done and the entry removed, or the entry is re-checked and given a new date.
- [ ] No secrets, tokens or personal data in the code, logs or release files.

## Usability (on the packaged app)

Install the draft release's installer on Windows, then:

- [ ] Old Kenku FM library appears after first start (fresh install on a computer with Kenku FM, Kenku FM closed): playlists, soundboards, bookmarks and the Discord token are there, and Kenku FM still works afterwards. **Required.**
- [ ] With Kenku FM still open, the first start of Cue Desk says to close Kenku FM; after quitting, closing Kenku FM and starting again, the library appears.
- [ ] Walk through this release's main tasks as a game master would (list them here): ____
- [ ] Core session flow still works: connect the bot, join a channel, play a playlist, trigger a soundboard sound, play a website tab.
- [ ] YouTube (or other website) tab audio reaches Discord: open YouTube in a tab, play a video, and listeners in the voice channel hear it. **Required.** Website tabs now use their own `persist:tabs` session, and capturing their audio from it has not been verified in a packaged build.
- [ ] Every message the app shows says what happened and what to do next.

## Accessibility

- [ ] Every new or changed control can be reached and used with the keyboard alone, with a visible focus.
- [ ] Every new or changed control has a name a screen reader announces (checked with NVDA or Narrator).
- [ ] Automated axe checks pass (once UI tests include them).

## Documentation and version

- [ ] `version` in `package.json` bumped, and the tag `vX.Y.Z` matches it.
- [ ] `CHANGELOG.md`: this version's section in plain language, moved out of *Unreleased*.
- [ ] README and `docs/` updated for anything users or developers now do differently.
- [ ] Draft release notes written in plain language, with install steps and known problems.

## Publish

- [ ] Product owner has read the release notes and approves.
- [ ] Draft release published. Auto-update checked from the previous version on one computer.
