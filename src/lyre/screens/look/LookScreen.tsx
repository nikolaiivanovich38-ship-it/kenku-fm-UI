/**
 * Look and feel (route `look`, UX-11): the five table themes, each card drawn in its own colours (its sample has its
 * own data-theme, so it shows the real tokens) with one plain sentence, "Use this theme" to use it everywhere, and
 * Theme to go back to each campaign's own. Ported from the prototype's views/look.js and look.css;
 * the prototype's "Try it in the prototype" is "Use this theme" here.
 */
import React from "react";

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
      <div className="viewbody">
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
