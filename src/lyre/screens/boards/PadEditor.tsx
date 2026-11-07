/**
 * The selected pad's own box (boards.js editorPane): Preview and Play on air, Label, Sound (one file, several
 * variants, or any effect with a tag), Play mode, Hotkey, Colour, Icon, Volume and Fade out. Every change is saved
 * at once through LyreApi; text is saved as you type.
 */
import React, { useEffect, useId, useState } from "react";
import type { LibraryTrack, Pad, PadBoard, PadColor, PadPatch, TagGroup, TagRef } from "../../../common/lyre/api";
import { PAD_COLORS } from "../../../common/lyre/api";
import { trackTitle } from "../../audio/lyreAudio";
import { Button, IconButton } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { PickerDialog } from "../../kit/Picker";
import { useLyreApi } from "../../api";
import { useAnnounce } from "../../shell/Announcer";
import { MODES, MODE_HELP, MODE_ICON, MODE_NAME, PAD_COLOUR, PAD_ICONS, iconName, keyLabel, keyOwner, padKeyFrom, plural, type PadAt } from "./boardModel";
import { useSavedText, useWrite, type BoardSound } from "./hooks";
import { PreviewButton } from "../../kit/SoundButtons";

export interface PadEditorProps {
  board: PadBoard;
  at: PadAt;
  tracks: readonly LibraryTrack[];
  tagGroups: readonly TagGroup[];
  sound: BoardSound;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  update: (patch: PadPatch, padId?: string) => Promise<Pad | null>;
  onFire: (pad: Pad) => void;
  /** Opens the pad's menu (Duplicate, Move to…, Delete) from this button. */
  onMenu: (anchor: HTMLElement) => void;
  menuOpen: boolean;
  /** Ask for focus on an element once the screen shows it (data-k, and data-pid when given). */
  focusLater: (k: string, options?: { pid?: string }) => void;
}

/** The label every new pad starts with (the library's default for a new pad). */
const NEW_PAD_LABEL = "New pad";

const SOUND_KINDS: [Pad["sound"]["kind"], string][] = [
  ["single", "One file"],
  ["variants", "Several variants"],
  ["tag", "Any with a tag"],
];

/** m:ss, as the prototype's L.fmt. */
function length(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PadEditor(props: PadEditorProps) {
  const { board, at, sound, open, onOpenChange, update, onFire, onMenu, menuOpen } = props;
  const pad = at.pad;
  const { say } = useAnnounce();
  const ids = useId();
  const on = sound.onAir(board.id, pad.id);
  const previewing = sound.previewing(board.id, pad.id);
  const label = useSavedText(pad.label, (text) => text.trim() && void update({ label: text.trim() }, pad.id), pad.id);
  const shownLabel = label.value.trim() ? label.value : pad.label;
  const color = useChosen(pad.id, pad.color, (c) => update({ color: c }, pad.id));
  const icon = useChosen(pad.id, pad.icon, (i) => update({ icon: i }, pad.id));

  return (
    <Pane
      id="pb-pad"
      title={`Pad: ${shownLabel}`}
      icon="edit"
      kind="plain"
      open={open}
      onOpenChange={onOpenChange}
      status={on ? { text: "Playing", tone: "live" } : previewing ? { text: "Preview", tone: "on" } : undefined}
      actions={
        <button
          type="button"
          className="btn s icon"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          aria-label="More for this pad"
          onClick={(e) => onMenu(e.currentTarget)}
        >
          <Icon name="more" size="s" />
        </button>
      }
    >
      <div className="pb-ed-body" style={{ "--pc": PAD_COLOUR[pad.color]?.hex ?? PAD_COLOUR.bone.hex } as React.CSSProperties}>
        <div className="pb-testrow">
          <Button className="pb-prev" icon={previewing ? "stop" : "headphones"} pressed={previewing} title="Only you hear it" onClick={() => sound.previewPad(board.id, pad.id)}>
            {previewing ? "Stop preview" : "Preview"}
          </Button>
          <Button icon={on && pad.mode === "toggle" ? "stop" : "broadcast"} pressed={on} title="The players hear it" onClick={() => onFire(pad)}>
            {on && pad.mode === "toggle" ? "Stop on air" : "Play on air"}
          </Button>
          {on && <span className="badge onair">On air</span>}
        </div>
        <div className="field">
          <label htmlFor={`${ids}-label`}>Label</label>
          <input
            id={`${ids}-label`}
            className="input"
            data-k="pb-label"
            data-pid={pad.id}
            value={label.value}
            onChange={(e) => label.onChange(e.target.value)}
            onFocus={label.onFocus}
            onBlur={label.onBlur}
          />
        </div>
        <SoundEditor {...props} />
        <fieldset className="pb-fs">
          <legend>Play mode</legend>
          <div className="pb-modes" role="group" aria-label="Play mode">
            {MODES.map((mode) => (
              <Button
                key={mode}
                size="s"
                icon={MODE_ICON[mode]}
                pressed={pad.mode === mode}
                aria-describedby={`${ids}-modehelp`}
                onClick={() => {
                  if (pad.mode === mode) return;
                  void update({ mode }).then((done) => done && say(`${MODE_NAME[mode]}. ${MODE_HELP[mode]}`));
                }}
              >
                {MODE_NAME[mode]}
              </Button>
            ))}
          </div>
          <p className="pb-modehelp" id={`${ids}-modehelp`}>
            {MODE_HELP[pad.mode]}
          </p>
        </fieldset>
        <Hotkey {...props} />
        <fieldset className="pb-fs">
          <legend>
            Colour <span className="pb-cur">{PAD_COLOUR[color.value]?.name}</span>
          </legend>
          <div className="pb-swatches">
            {PAD_COLORS.map((c: PadColor) => (
              <label key={c} className="pb-sw" title={PAD_COLOUR[c].name} style={{ "--pc": PAD_COLOUR[c].hex } as React.CSSProperties}>
                <input type="radio" className="pb-vh" name={`${ids}-colour`} value={c} checked={color.value === c} onChange={() => color.choose(c)} />
                <span className="pb-sw-dot" />
                <span className="sr-only">{PAD_COLOUR[c].name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="pb-fs">
          <legend>
            Icon <span className="pb-cur">{iconName(icon.value)}</span>
          </legend>
          <div className="pb-icons">
            {PAD_ICONS.map(([id, name]) => (
              <label key={id} className="pb-ic" title={name}>
                <input type="radio" className="pb-vh" name={`${ids}-icon`} value={id} checked={icon.value === id} onChange={() => icon.choose(id)} />
                <Icon name={id} />
                <span className="sr-only">{name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Levels {...props} />
      </div>
    </Pane>
  );
}

/**
 * BUG-16: a choice among radio buttons (colour, icon) shows at once and stays shown until the library has saved it.
 * Showing the pad's saved value instead made the radio jump back while the save was on its way; React then lost track
 * of which button the browser had ticked, so clicking the same icon again did nothing.
 */
function useChosen<T extends string>(padId: string, saved: T, save: (value: T) => Promise<unknown>) {
  const [chosen, setChosen] = useState<{ padId: string; value: T } | null>(null);
  const pending = chosen?.padId === padId ? chosen.value : null;
  // Saved (or another pad shown): the library's value is the one to show again.
  useEffect(() => {
    if (pending !== null && pending === saved) setChosen(null);
  }, [pending, saved]);
  return {
    value: pending ?? saved,
    choose: (value: T) => {
      setChosen({ padId, value });
      void save(value).then((result) => {
        // Refused (the toast says why): show what is saved again.
        if (result === null || result === undefined) setChosen((now) => (now?.padId === padId && now.value === value ? null : now));
      });
    },
  };
}

/* ---------- Sound ---------- */

function SoundEditor({ board, at, tracks, tagGroups, sound, update, focusLater }: PadEditorProps) {
  const pad = at.pad;
  const s = pad.sound;
  const api = useLyreApi();
  const write = useWrite();
  const { say, toast } = useAnnounce();
  const ids = useId();
  const [picking, setPicking] = useState(false);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const fx = tracks.filter((t) => t.kind === "fx");

  /** A new pad takes the name of its first sound (in the same change), so two new pads never share "New pad". */
  const nameFrom = (trackId: string | undefined): { label?: string } => {
    const t = trackId ? byId.get(trackId) : undefined;
    return pad.label === NEW_PAD_LABEL && t ? { label: trackTitle(t) } : {};
  };

  const chooseKind = (kind: Pad["sound"]["kind"]) => {
    if (s.kind === kind) return;
    void update({ sound: { kind } });
  };

  const addFiles = async () => {
    const summary = await write(api.import.start({ from: "choose-files" }));
    if (!summary || summary.cancelled) return;
    if (summary.problems.length) toast(summary.summary);
    const got = summary.trackIds;
    if (!got.length) return;
    if (s.kind === "single") {
      const done = await update({ sound: { trackIds: [got[0]] }, ...nameFrom(got[0]) });
      if (done) say(`File chosen: ${trackTitle(byId.get(got[0]))}`);
    } else {
      const next = [...s.trackIds, ...got.filter((id) => !s.trackIds.includes(id))];
      const done = await update({ sound: { trackIds: next }, ...nameFrom(got[0]) });
      if (done) say(`Added ${plural(next.length - s.trackIds.length, "file")}. ${plural(next.length, "variant")}.`);
    }
  };

  const fileRow = (t: LibraryTrack | undefined, id: string, i: number, list: string[]) => (
    <li key={id}>
      <Icon name="file" size="s" />
      <span className="ellipsis grow" title={t ? `${t.folder}\\${t.fileName}` : undefined}>
        {t ? (
          <>
            {trackTitle(t)} <span className="faint">{t.fileName}</span>
          </>
        ) : (
          "A track that is no longer in the library"
        )}
      </span>
      {t && <PreviewButton target={{ kind: "track", id: t.id }} name={trackTitle(t)} />}
      {s.kind === "variants" && list.length > 1 && (
        <IconButton
          icon="close"
          quiet
          label={`Remove ${t?.fileName ?? "this file"} from this pad`}
          hint="Remove from this pad"
          data-k={`pbrm-${i}`}
          onClick={() => {
            void update({ sound: { trackIds: list.filter((x) => x !== id) } }).then((done) => {
              if (!done) return;
              say(`Removed ${t?.fileName ?? "the file"}`);
              focusLater("pb-addfile");
            });
          }}
        />
      )}
    </li>
  );

  let body: React.ReactNode;
  if (s.kind === "tag") {
    body = <TagSound key={pad.id} {...{ board, at, tracks, tagGroups, update }} />;
  } else {
    const list = s.kind === "single" ? s.trackIds.slice(0, 1) : s.trackIds;
    body = (
      <>
        {list.length ? <ul className="pb-files">{list.map((id, i) => fileRow(byId.get(id), id, i, list))}</ul> : <p className="pb-none">No file yet.</p>}
        <div className="row-flex pb-filerow">
          <Button size="s" icon="library" onClick={() => setPicking(true)}>
            Choose from library…
          </Button>
          <Button size="s" variant="ghost" icon="file" data-k="pb-addfile" onClick={() => void addFiles()}>
            {s.kind === "single" ? (list.length ? "Replace with a file…" : "Choose a file…") : "Add a file…"}
          </Button>
          {s.kind === "variants" && (
            <span className="pb-order">
              <span className="pb-order-l">Order</span>
              <div className="seg s" role="group" aria-label="Order of variants">
                <button type="button" aria-pressed={s.order !== "in_turn"} onClick={() => void update({ sound: { order: "random" } })}>
                  <Icon name="shuffle" size="s" />
                  Random
                </button>
                <button type="button" aria-pressed={s.order === "in_turn"} onClick={() => void update({ sound: { order: "in_turn" } })}>
                  In turn
                </button>
              </div>
            </span>
          )}
        </div>
      </>
    );
  }

  return (
    <fieldset className="pb-fs pb-sound">
      <legend id={`${ids}-sound`}>Sound</legend>
      <div className="seg s pb-seg-wide" role="group" aria-label="Sound comes from">
        {SOUND_KINDS.map(([kind, name]) => (
          <button key={kind} type="button" aria-pressed={s.kind === kind} onClick={() => chooseKind(kind)}>
            {name}
          </button>
        ))}
      </div>
      {body}
      <PickerDialog
        open={picking}
        title={`Sounds for "${pad.label}"`}
        intro="Tick one effect, or several to play them as variants. Preview lets you hear each one first; the players hear nothing."
        items={fx.map((t) => ({
          id: t.id,
          label: trackTitle(t),
          sub: `FX · ${length(t.durationMs)}`,
          search: [t.metaTitle, t.fileName, ...Object.values(t.tags).flat()].join(" "),
        }))}
        selected={s.trackIds.filter((id) => byId.get(id)?.kind === "fx")}
        multi
        renderActions={(item) => <PreviewButton target={{ kind: "track", id: item.id }} name={item.label} />}
        hint={
          <p className="hint" style={{ marginTop: 6 }}>
            <Icon name="headphones" size="s" /> Preview plays in your headphones only.
          </p>
        }
        onClose={() => {
          setPicking(false);
          // Closing the picker stops its preview, so nothing keeps playing in your headphones.
          if (sound.previewKey && byId.has(sound.previewKey)) sound.audio.stopPreview();
        }}
        onDone={(chosen) => {
          setPicking(false);
          if (sound.previewKey && byId.has(sound.previewKey)) sound.audio.stopPreview();
          if (!chosen.length) return;
          const becomesVariants = chosen.length > 1 && s.kind !== "variants";
          const kind = becomesVariants ? "variants" : s.kind === "tag" ? "single" : s.kind;
          void update({ sound: { trackIds: chosen, kind }, ...nameFrom(chosen[0]) }).then((done) => {
            if (!done) return;
            if (becomesVariants) toast(`${plural(chosen.length, "sound")} chosen, so the pad plays them as variants`);
            say(`${plural(chosen.length, "sound")} from the library on ${pad.label}`);
          });
        }}
      />
    </fieldset>
  );
}

/** "Any with a tag": type a tag; every FX track with it is listed, and each press picks one of them. */
function TagSound({ at, tracks, tagGroups, update }: Pick<PadEditorProps, "board" | "at" | "tracks" | "tagGroups" | "update">) {
  const s = at.pad.sound;
  const ids = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? s.tag?.value ?? "";
  const findTag = (value: string): TagRef | null => {
    const want = value.trim().toLowerCase();
    if (!want) return null;
    for (const g of tagGroups) {
      const hit = g.values.find((v) => v.toLowerCase() === want);
      if (hit) return { group: g.id, value: hit };
    }
    return null;
  };
  const tag = typed === null ? s.tag : findTag(typed);
  const matches = tag ? tracks.filter((t) => t.kind === "fx" && (t.tags[tag.group] ?? []).includes(tag.value)) : [];
  const values = [...new Set(tagGroups.flatMap((g) => g.values))];
  return (
    <>
      <div className="field">
        <label htmlFor={`${ids}-tag`}>Tag</label>
        <input
          id={`${ids}-tag`}
          className="input"
          list={`${ids}-tags`}
          value={text}
          placeholder="For example: Eerie"
          onChange={(e) => {
            setTyped(e.target.value);
            const found = findTag(e.target.value);
            if (found && (found.group !== s.tag?.group || found.value !== s.tag?.value)) void update({ sound: { tag: found } });
          }}
        />
        <datalist id={`${ids}-tags`}>
          {values.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </div>
      <p className="hint">Each press picks one of these {plural(matches.length, "effect")}.</p>
      {matches.length ? (
        <ul className="pb-files">
          {matches.map((t) => (
            <li key={t.id}>
              <Icon name="file" size="s" />
              <span className="ellipsis grow">
                {trackTitle(t)} <span className="faint">{t.fileName}</span>
              </span>
              <PreviewButton target={{ kind: "track", id: t.id }} name={trackTitle(t)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="pb-none">No effects have this tag yet.</p>
      )}
    </>
  );
}

/* ---------- Hotkey ---------- */

function Hotkey({ board, at, update, focusLater }: PadEditorProps) {
  const pad = at.pad;
  const { say } = useAnnounce();
  const ids = useId();
  const [capturing, setCapturing] = useState(false);
  const other = keyOwner(board, pad.key, pad.id);
  const showHint = capturing || at.where === "spare";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!capturing || ["Tab", "Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(false);
      say("Hotkey unchanged");
    } else if (e.key === "Backspace" || e.key === "Delete") {
      setCapturing(false);
      void update({ key: "" }).then((done) => done && say("Hotkey removed"));
    } else {
      const key = padKeyFrom(e.key);
      if (!key) {
        say("That key cannot be used. Try a letter, a number or F1 to F12.");
        return;
      }
      setCapturing(false);
      const owner = keyOwner(board, key, pad.id);
      void update({ key }).then((done) => done && say(`Hotkey ${keyLabel(key)}${owner ? `. Warning: ${owner.label} uses it too` : ""}`));
    }
  };

  return (
    <div className="field">
      <span className="label" id={`${ids}-l`}>
        Hotkey
      </span>
      <div className="row-flex">
        <button
          type="button"
          className={capturing ? "pb-keycap capturing" : "pb-keycap"}
          data-k="pb-keycap"
          aria-labelledby={`${ids}-l ${ids}-t`}
          aria-describedby={showHint ? `${ids}-h` : undefined}
          onClick={() => setCapturing(!capturing)}
          onKeyDown={onKeyDown}
          onBlur={() => setCapturing(false)}
        >
          <span id={`${ids}-t`}>
            {capturing ? (
              "Press a key…"
            ) : pad.key ? (
              <>
                <span className="kbd">{keyLabel(pad.key)}</span> Change
              </>
            ) : (
              "None. Click, then press a key"
            )}
          </span>
        </button>
        {pad.key && !capturing && (
          <Button
            size="s"
            variant="ghost"
            onClick={() =>
              void update({ key: "" }).then((done) => {
                if (!done) return;
                say("Hotkey removed");
                focusLater("pb-keycap");
              })
            }
          >
            Clear
          </Button>
        )}
      </div>
      {showHint && (
        <p className="hint" id={`${ids}-h`}>
          {capturing ? "Esc cancels, Backspace removes the key." : "This pad is spare, so its key does nothing until it is back on the grid."}
        </p>
      )}
      {other && (
        <p className="pb-warn" role="alert">
          <Icon name="bolt" size="s" />
          <span className="grow">
            {keyLabel(pad.key)} is also the key for &quot;{other.label}&quot; on this board.
          </span>
          <Button
            size="s"
            onClick={() =>
              void update({ key: "" }, other.id).then((done) => {
                if (!done) return;
                say(`${keyLabel(pad.key)} now belongs to ${pad.label} only. ${other.label} has no key.`);
                focusLater("pb-keycap");
              })
            }
          >
            Take it from that pad
          </Button>
        </p>
      )}
    </div>
  );
}

/* ---------- Volume and fade ---------- */

function Levels({ at, update }: PadEditorProps) {
  const pad = at.pad;
  const ids = useId();
  const volume = useSavedText(String(Math.round(pad.volume * 100)), (text) => void update({ volume: Number(text) / 100 }, pad.id), pad.id, 250);
  const fade = useSavedText(
    String(pad.fadeOutMs / 1000),
    (text) => {
      const seconds = parseFloat(text);
      if (!Number.isNaN(seconds)) void update({ fadeOutMs: Math.round(Math.max(0, Math.min(10, seconds)) * 1000) }, pad.id);
    },
    pad.id,
  );
  return (
    <div className="pb-levels">
      <div className="field grow">
        <label htmlFor={`${ids}-vol`}>
          Volume{" "}
          <output htmlFor={`${ids}-vol`} className="num">
            {volume.value}
          </output>
        </label>
        <input
          id={`${ids}-vol`}
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume.value}
          onChange={(e) => volume.onChange(e.target.value)}
          onFocus={volume.onFocus}
          onBlur={volume.onBlur}
        />
      </div>
      <div className="field pb-fade">
        <label htmlFor={`${ids}-fade`}>Fade out (seconds)</label>
        <input
          id={`${ids}-fade`}
          className="input num"
          type="number"
          min={0}
          max={10}
          step={0.5}
          value={fade.value}
          onChange={(e) => fade.onChange(e.target.value)}
          onFocus={fade.onFocus}
          onBlur={fade.onBlur}
        />
      </div>
    </div>
  );
}
