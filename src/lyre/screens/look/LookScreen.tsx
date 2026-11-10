/**
 * Look and feel (route `look`, UX-11): the five table themes, each card drawn in its own colours (its sample has its
 * own data-theme, so it shows the real tokens) with one plain sentence, "Use this theme" to use it everywhere, and
 * Theme to go back to each campaign's own. Ported from the prototype's views/look.js and look.css;
 * the prototype's "Try it in the prototype" is "Use this theme" here.
 */
import React, { useEffect, useRef, useState } from "react";

import { DEFAULT_DISPLAY, type DisplaySettings } from "../../../common/domain";
import { useLyreApi, useSettings } from "../../api";
import { applyDisplay, pageZoom } from "../../shell/display";
import { useSave } from "../../shell/useSave";
import { Select } from "../../kit/Fields";
import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { THEME_CHOICES, type ThemeChoice, type ThemeId } from "../../shell/themes";
import { useThemeChoice } from "../../shell/useThemeChoice";
import "./look.css";
import { TopLead } from "../../shell/TopBar";

interface ThemeCard {
  id: ThemeId;
  name: string;
  games: string;
  /** One plain sentence for a game master choosing a theme (w3-ux 8). */
  line: string;
}

/** The prototype's words for each theme, in its order. */
const CARDS: readonly ThemeCard[] = [
  { id: "candle", name: "Candlelit Library", games: "Lyre's default; wizarding schools, academies, mysteries", line: "Ink blue and candle gold, like a library after dark: Lyre's own theme, for any campaign without one." },
  { id: "fern", name: "Fern and Brass", games: "Lyre's own colours; any game", line: "Green-black and brass, the colours of Lyre's logo, calm for long sessions in any world." },
  { id: "hearth", name: "Hearth and Iron", games: "D&D, Pathfinder, sword and sorcery", line: "Warm stone and ember light for dungeons, taverns and sword and sorcery." },
  { id: "parchment", name: "Parchment", games: "The light version of Candlelit Library", line: "A light theme for preparing in daylight; you can still run the session in a dark one." },
  { id: "elysium", name: "Elysium", games: "Vampire: the Masquerade, gothic and noir", line: "Soot black, bone and blood red for gothic and vampire chronicles." },
];

export function LookScreen() {
  const [choice, setChoice] = useThemeChoice();
  const { toast } = useAnnounce();
  const use = (card: ThemeCard) => {
    setChoice(card.id);
    toast(`Lyre now uses ${card.name}`);
  };
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>Look and feel</h1>
        <span className="muted">One Lyre, a theme per table</span>
      </div>
      <div className="viewbody" data-scroll="body">
        <Display />
        <div className="lk-intro">
          <p>Each campaign can have its own theme, and Lyre switches to it when you open that campaign. Choose one here to use it everywhere.</p>
          <Select<ThemeChoice> className="lk-choice" label="Theme" value={choice} options={THEME_CHOICES} onChange={setChoice} />
        </div>
        <div className="lk-grid">
          {CARDS.map((card) => (
            <Card key={card.id} card={card} inUse={choice === card.id} onUse={() => use(card)} />
          ))}
        </div>
        <h2 className="display lk-h2">Same in every theme</h2>
        <div className="lk-fixed">
          <div>
            <span className="lane-dot music" />
            <b>Music</b> blue
          </div>
          <div>
            <span className="lane-dot amb" />
            <b>Ambience</b> teal
          </div>
          <div>
            <span className="lane-dot fx" />
            <b>Effects</b> amber
          </div>
          <div>
            <span className="lane-dot preview" />
            <b>Preview</b> violet: only you hear it
          </div>
          <div>
            <span className="badge onair">On air</span> what the players hear
          </div>
          <div>
            <span className="kbd">Tab</span> gold focus outline
          </div>
        </div>
      </div>
    </>
  );
}

function Card({ card, inUse, onUse }: { card: ThemeCard; inUse: boolean; onUse: () => void }) {
  const headingId = `lk-${card.id}`;
  return (
    <article className="lk-card" aria-label={card.name}>
      <header>
        <h2 className="display" id={headingId}>
          {card.name}
        </h2>
        <span className="muted">{card.games}</span>
      </header>
      <Sample card={card} />
      <p>{card.line}</p>
      <button type="button" className={cx("btn", inUse && "primary")} aria-label={inUse ? `In use: ${card.name}` : `Use this theme: ${card.name}`} onClick={onUse}>
        {inUse ? (
          <>
            <Icon name="check" size="s" />
            In use
          </>
        ) : (
          "Use this theme"
        )}
      </button>
    </article>
  );
}

/**
 * A small piece of Lyre in the theme's own colours. It is a picture: hidden from screen readers, with no real
 * controls.
 */
function Sample({ card }: { card: ThemeCard }) {
  return (
    <div className="lk-sample" data-theme={card.id}>
      <div className="lk-pic" aria-hidden="true">
        <div className="lk-head">
          <span className="pane-title">{card.name}</span>
          <span className="chip accent">{card.games.split(",")[0]}</span>
        </div>
        <div className="lk-row">
          <span className="lane-dot music" />
          <div className="grow">
            <div className="ellipsis">
              <b>Ancient sorrow, choir</b>
            </div>
            <div className="progress music">
              <span style={{ width: "42%" }} />
            </div>
          </div>
          <span className="num muted">1:54</span>
          <span className="btn s">
            <Icon name="fade" size="s" />
            Fade
          </span>
        </div>
        <div className="lk-row">
          <span className="lane-dot amb" />
          <div className="grow">
            <div className="ellipsis">Crypt drips</div>
            <div className="progress amb">
              <span style={{ width: "70%" }} />
            </div>
          </div>
          <span className="badge onair">On air</span>
        </div>
        <div className="chips">
          <span className="chip mood">
            <span className="dot" />
            Eerie
          </span>
          <span className="chip motif">
            <span className="dot" />
            Drowned Abbess
          </span>
          <span className="chip scene">
            <span className="dot" />
            Ritual
          </span>
        </div>
        <div className="lk-btns">
          <span className="btn primary">Start scene</span>
          <span className="btn">Preview</span>
          <span className="btn ghost">More</span>
        </div>
        <div className="lk-sw" aria-hidden="true">
          <i style={{ background: "var(--bg)" }} />
          <i style={{ background: "var(--surface)" }} />
          <i style={{ background: "var(--surface-3)" }} />
          <i style={{ background: "var(--ink)" }} />
          <i style={{ background: "var(--accent)" }} />
          <i style={{ background: "var(--second)" }} />
        </div>
      </div>
    </div>
  );
}

/**
 * UX-11, A11Y-6 (design round 7, look.js displayHTML): Display, kept on this computer. Density (Compact, Lyre's
 * default, or Comfortable), Text size 100 to 200 % (the whole page zooms), High contrast, and Tag colours… (they are
 * set with the tags). Each change shows the Saved pop-up.
 */
function Display() {
  const api = useLyreApi();
  const save = useSave();
  const stored = useSettings().data?.display;
  const [shown, setShown] = useState<DisplaySettings>(stored ?? DEFAULT_DISPLAY);
  // The slider's value while it is moved; the size applies when it is let go (or on each arrow key).
  const [sliding, setSliding] = useState<number | null>(null);
  /** Whether the Text size slider is being dragged. */
  const dragging = useRef(false);
  useEffect(() => {
    if (stored) setShown(stored);
  }, [stored]);
  const change = (patch: Partial<DisplaySettings>, what: string, key: string) => {
    const next = { ...shown, ...patch };
    setShown(next);
    applyDisplay(next, pageZoom());
    void save(what, () => api.settings.setComputer({ display: patch }), { key });
  };
  const size = sliding ?? shown.textSize;
  return (
    <section className="lk-display" aria-label="Display">
      <h2 className="display lk-h2">Display</h2>
      <div className="lk-drow">
        <div className="lk-dgrp" role="radiogroup" aria-label="Density">
          <span className="lk-dl" aria-hidden="true">
            Density
          </span>
          {(
            [
              ["compact", "Compact", "28 px controls, 30 px rows: Lyre's default"],
              ["comfortable", "Comfortable", "Larger controls and rows, more space between them"],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="lk-radio" title={hint}>
              <input
                type="radio"
                name="lk-density"
                value={value}
                checked={shown.density === value}
                onChange={(event) => event.target.checked && change({ density: value }, `density ${label}`, "lk-density")}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <label className="lk-dgrp lk-size">
          <span className="lk-dl">Text size</span>
          <input
            type="range"
            min={100}
            max={200}
            step={25}
            value={size}
            aria-valuetext={`${size} percent`}
            onChange={(event) => {
              const v = Number(event.target.value);
              setSliding(v);
              // An arrow key is a whole change; a drag applies when it is let go.
              if (!dragging.current) {
                setSliding(null);
                change({ textSize: v }, `text size ${v} %`, "lk-size");
              }
            }}
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={(event) => {
              dragging.current = false;
              const v = Number((event.target as HTMLInputElement).value);
              setSliding(null);
              if (v !== shown.textSize) change({ textSize: v }, `text size ${v} %`, "lk-size");
            }}
          />
          <span className="num lk-sizev" aria-hidden="true">
            {size} %
          </span>
        </label>
        <label className="lk-switch lk-dgrp" title="Hints and quiet text as strong as the rest, stronger lines, in every theme">
          <input
            type="checkbox"
            role="switch"
            checked={shown.highContrast}
            onChange={(event) => change({ highContrast: event.target.checked }, `high contrast ${event.target.checked ? "on" : "off"}`, "lk-contrast")}
          />
          <b>High contrast</b>
        </label>
        <a className="btn s ghost" href="#/tags" title="Each tag group and tag can have a colour; the tag's name always shows with it">
          <Icon name="tag" size="s" />
          Tag colours…
        </a>
      </div>
    </section>
  );
}
