# Help in the app, the first-run tour and Save diagnostics (FND-8, FND-9)

Nik, 6 Nov 2026: less text and clutter on screen. Help costs the screens nothing until asked for.

Try it: open `design/prototype/lyre-prototype.html` in a fresh browser profile (the tour shows once), or press **F1**
on any screen. Code: `src/views/help.js`, `src/views/help.css`, the rail entry in `src/core.js` (`railHTML`). Specs:
`e2e/specs/help.spec.ts`.

## Help

- **One entry**: **Help**, with its icon and name, at the foot of the rail under **Look and feel**; **F1** from any
  screen. It is a button (it opens a panel, not a screen): `aria-expanded`, `aria-keyshortcuts="F1"`.
- **A side panel** beside the screen (340 px), over it when the app is narrower than 900 px. The screen beside it
  keeps working, so an article's steps can be followed with it open, and it stays open across screens.
  - Header: **Help** and **Close help** (Esc).
  - **Search help**: every word typed must be in the title, the article's search words or its text; title hits come
    first. "Nothing found. Try other words." Esc in the box clears it, then closes Help.
  - The articles, grouped by task (one list per group, named by its heading).
  - An article: **Back**, its title (focused when it opens), the text. Back returns to the list with focus on the
    article it came from.
  - Foot: **Take the tour** and **Save diagnostics…**.
- **Keys stay in Help.** A key pressed in the panel or the tour does not reach a screen's single-key shortcuts (Space,
  /, pad keys in Live); Ctrl and Alt keys, F keys and Shift+Esc (fade all) still do.
- **F1 and pads.** A pad key can be F1 to F12. In Live, a pad on F1 plays it (Live takes the key first); Help is
  still one click away in the rail.
- No help text is added to any screen. Screens are unchanged.

## The tour

- On the first start of the Lyre tab, once. A small popover with an arrow, and a ring around what it points at:

| Step | Points at | Words |
| --- | --- | --- |
| 1 of 5 Lyre's places | the rail | Everything is a click away here. Help is at the foot, or press F1. |
| 2 of 5 Library | Library in the rail | Add your music here and tag it. |
| 3 of 5 Scenes | Campaigns in the rail | Scenes are in Campaigns: a campaign holds its sessions, a session its scenes. |
| 4 of 5 Live | Live in the rail | Run the session here. Space starts the next scene. |
| 5 of 5 Now playing | the Now playing bar (its place at the foot when nothing plays) | What plays shows down here. On air: the players hear it. Only you: your headphones. |

- **Skip** on every step, **Back** from step 2, **Next**, **Done** on the last. Esc skips. Focus starts on Next.
  It is not modal: the screen under it still works.
- Remembered as seen per user (the Lyre page's own settings, `lyre-shell`, in the user's data folder), whether
  finished or skipped. **Help › Take the tour** plays it again; at its end focus goes back to Help.
- A scene is pointed at through Campaigns: on a first start there is usually no campaign yet, so there is no scene
  to point at.

## Save diagnostics (FND-9)

- **Help › Save diagnostics…** asks for a folder (Documents first), then saves one zip there and says so in one line
  under the buttons: "Saved in Documents: Lyre diagnostics 2026-11-06 14-32.zip", with **Show in folder**. While it
  works the button reads "Saving…". Cancelling the folder chooser saves nothing and says nothing.
- In the zip: `about.json` (Lyre's version, Electron and Chrome, the operating system and its version, the
  processor's architecture, the language), `log.txt` (the last 500 lines of Lyre's log since it started),
  `settings.json` (the main window's and the Lyre page's settings, the library's normalise setting, each bot's
  status; never a token or other secret), `blocked.txt` (warnings about blocked content: pages, addresses,
  permissions and messages Lyre refused) and `README.txt` (what each file is, in plain words).
- Taken out everywhere: bot tokens (and anything that looks like one), any value whose name says token, secret,
  password, key or credential, and the user's home folder in paths (written as `~`). Not in it: music, the library,
  people's Discord names, bookmarks.
- Nothing is sent anywhere. The prototype has no folder chooser and "saves" to Documents.

## Articles (src/lyre/help/articles, plain words, each under 300)

The app and the prototype read the same Markdown files. Each starts with `title`, `group` and `words` (extra search
words) between `---` lines; then paragraphs, `- ` lists and `1. ` steps, one line each; `**Label**` for something
named on screen and `` `Key` `` for a key.

| Group | Article |
| --- | --- |
| Get started | Connect Discord and bring a bot into a room |
| Get started | What came across from Kenku FM |
| Prepare | Add your music and tag it |
| Prepare | Make a playlist from tags |
| Prepare | Plan a campaign, session and scenes |
| Prepare | How a track plays (Audio profile) |
| Prepare | Pad boards |
| Prepare | Shuffle and repeat per place |
| Prepare | Normalise volume |
| Run a session | Run a session in Live |
| Run a session | Preview or play on air |
| Your library | Back up, move or share |
| Your library | Find missing files |
| Your library | Save diagnostics for a bug report |

Each article describes the app as built in wave 4, round 5 included (Try pads, the play order button in scenes and
the session and campaign lists, names in scenes, single tracks on hand, the wave button from a scene), checked after
those streams merged.

## Words added

Help, Close help, Search help, Nothing found. Try other words., Back, Take the tour, Save diagnostics…, Saving…,
Saved in …, Show in folder, Skip, Next, Done, n of 5.
