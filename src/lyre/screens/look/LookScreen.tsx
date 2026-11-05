/**
 * Look and feel (route `look`, UX-11): the five table themes, each card drawn in its own colours (its sample carries
 * its own data-theme, so it shows the real tokens) with its contrast worked out live, "Use this theme" to use it
 * everywhere, and Theme to go back to each campaign's own. Ported from the prototype's views/look.js and look.css;
 * the prototype's "Try it in the prototype" is "Use this theme" here.
 */
import React, { useLayoutEffect, useRef } from "react";

import { Select } from "../../kit/Fields";
import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { THEME_CHOICES, type ThemeChoice, type ThemeId } from "../../shell/themes";
import { useThemeChoice } from "../../shell/useThemeChoice";
import { contrastLine } from "./contrast";
import "./look.css";

interface ThemeCard {
  id: ThemeId;
  name: string;
  games: string;
  words: string;
  why: string;
  type: string;
}

/** The prototype's words for each theme, in its order. */
const CARDS: readonly ThemeCard[] = [
  {
    id: "candle",
    name: "Candlelit Library",
    games: "Lyre's default; wizarding schools, academies, mysteries",
    words: "Ink-blue night, candle gold, parchment and an oxblood ribbon.",
    why: "Deep ink blue with candle gold, the colours of a library after curfew. Your choice for Lyre's default: the Campaigns page, Look and feel and every campaign without a theme of its own use it. An oxblood second colour gives a house-colour accent without clashing with the gold.",
    type: "Cormorant Garamond headings: an old book face, set a little larger because it is light.",
  },
  {
    id: "fern",
    name: "Fern and Brass",
    games: "Lyre's own colours; any game",
    words: "Fern gully at dusk, an old brass instrument by candlelight.",
    why: "Taken straight from the logo, so the app and its icon match. Green-black is calm for four hours of play and suits fantasy, folk horror and historical games alike.",
    type: "Lora headings: a bookish serif, also the face of the Lyre wordmark.",
  },
  {
    id: "hearth",
    name: "Hearth and Iron",
    games: "D&D, Pathfinder, sword and sorcery",
    words: "Dungeon stone, forge light, a map on a tavern table.",
    why: "Warm soot-brown surfaces with an ember accent and a verdigris second colour (old copper). Reads as torchlight without turning orange everywhere: ember marks only the selected row, the primary button and the pane being worked on.",
    type: "Cinzel headings: capitals cut like an inscription over a dungeon door. Used only for titles, never for anything you read at length.",
  },
  {
    id: "parchment",
    name: "Parchment",
    games: "The light version of Candlelit Library",
    words: "Daylight prep at a desk by the window.",
    why: "For building playlists and tagging in daylight, when a dark screen is hard to read. Lane and status colours are darkened so they keep their contrast on paper. You can use it for prep and still run the session in a dark theme.",
    type: "Cormorant Garamond headings, oxblood accent, ink text.",
  },
  {
    id: "elysium",
    name: "Elysium",
    games: "Vampire: the Masquerade, gothic and noir",
    words: "Soot black, bone, blood and tarnished gold.",
    why: "Near-black with bone text and blood red in the frame; your actions and selections are in tarnished gold, so they never look like Lyre's red On air signal. Spaced capitals in the headings suggest a court invitation.",
    type: "Cormorant Garamond in spaced capitals.",
  },
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
        <h1>Look and feel</h1>
        <span className="muted">One Lyre, a theme per table</span>
      </div>
      <div className="viewbody">
        <div className="lk-intro">
          <p>
            <b>Your choice:</b> all five themes, with Candlelit Library as the default. Each campaign can pick its own table theme. You run games in very
            different worlds. A glance tells you which campaign is loaded before you fire anything, and the screen fits the mood of the table. Only colour
            and heading type change: buttons, layout and keys stay in the same places, so nothing has to be relearned between campaigns. The cost is testing
            five palettes instead of one. A check runs over every theme so a change cannot slip below the contrast floor.
          </p>
          <p className="muted">Fern and Brass stays as the logo&apos;s own palette (the icon and installer use it) and as a theme a campaign can choose.</p>
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
        <h2 className="display lk-h2">Density</h2>
        <p className="lk-p">
          Controls are 28 px high and closers 24 px (the WCAG 2.2 minimum), down from 44 px. Body text is 13.5 px Atkinson Hyperlegible, a face made for
          low-vision readers, so text stays readable at the smaller size. Rows are 30 px, so about twice as many tracks fit in the same height.
        </p>
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
      <p className="lk-words">
        <i>{card.words}</i>
      </p>
      <p>{card.why}</p>
      <p className="faint">{card.type}</p>
      <button type="button" className={cx("btn", inUse && "primary")} aria-describedby={headingId} onClick={onUse}>
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
 * controls; only the contrast line under it is read.
 */
function Sample({ card }: { card: ThemeCard }) {
  const ref = useRef<HTMLDivElement>(null);
  const contrast = useRef<HTMLParagraphElement>(null);
  // Worked out from the theme's tokens once the card is on the page (and again if fonts or tokens change it).
  useLayoutEffect(() => {
    if (ref.current && contrast.current) contrast.current.textContent = contrastLine(ref.current);
  });
  return (
    <div className="lk-sample" data-theme={card.id} ref={ref}>
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
      <p className="lk-contrast faint" ref={contrast} />
    </div>
  );
}
