/**
 * FND-8: the first-run tour (design/prototype/HELP.md "The tour", views/help.js): five short steps in a small
 * popover with an arrow, and a ring around what each points at. Not modal: the screen under it keeps working.
 * Skip on every step, Back from the second, Esc skips. The shell decides when it shows (useHelp.tsx).
 */
import React, { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../kit/Button";
import { keepKeysHere } from "./keys";

export interface TourStep {
  title: string;
  text: string;
  /** What it points at; `bottom`: the Now playing bar, or its place at the foot of the screen. */
  target: () => Element | null;
  bottom?: boolean;
}

const railLink = (section: string) => () => document.querySelector(`#app .rail a[href="#/${section}"]`);

export const TOUR_STEPS: readonly TourStep[] = [
  { title: "Lyre's places", text: "Everything is a click away here. Help is at the foot, or press F1.", target: () => document.querySelector("#app .rail nav") },
  { title: "Library", text: "Add your music here and tag it.", target: railLink("library") },
  { title: "Scenes", text: "Scenes are in Campaigns: a campaign holds its sessions, a session its scenes.", target: railLink("campaigns") },
  { title: "Live", text: "Run the session here. Space starts the next scene.", target: railLink("live") },
  {
    title: "Now playing",
    text: "What plays shows down here. On air: the players hear it. Only you: your headphones.",
    target: () => document.querySelector("#view .onairbar") ?? document.getElementById("view"),
    bottom: true,
  },
];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TourProps {
  step: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function Tour({ step, onNext, onBack, onSkip }: TourProps) {
  const s = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<{ ring: Box; left: number; top: number; arrow: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const target = s.target();
      const pop = popRef.current;
      if (!target || !pop) return;
      setPlace(placeFor(target.getBoundingClientRect(), s.bottom === true && !target.classList.contains("onairbar"), !!s.bottom, pop));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [s]);
  useLayoutEffect(() => nextRef.current?.focus(), [step]);

  return (
    <div
      id="lyre-tour"
      onKeyDown={(event) => {
        keepKeysHere(event);
        if (event.key === "Escape" && !event.shiftKey) {
          event.preventDefault();
          onSkip();
        }
      }}
    >
      {place && <div className="tour-ring" aria-hidden="true" style={place.ring} />}
      <div
        ref={popRef}
        className="tour"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title tour-count"
        aria-describedby="tour-text"
        data-side={s.bottom ? "top" : "right"}
        style={place ? ({ left: place.left, top: place.top, "--arrow": `${place.arrow}px` } as React.CSSProperties) : { left: 8, top: 8 }}
      >
        <p className="tour-count" id="tour-count">
          {step + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="tour-title" id="tour-title">
          {s.title}
        </h2>
        <p id="tour-text">{s.text}</p>
        <div className="tour-btns">
          <Button variant="ghost" size="s" onClick={onSkip}>
            Skip
          </Button>
          <span className="grow" />
          {step > 0 && (
            <Button size="s" onClick={onBack}>
              Back
            </Button>
          )}
          <Button ref={nextRef} variant="primary" size="s" onClick={onNext}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Where the ring and the popover go: right of a rail item (arrow at its middle), or above the foot of the screen
 * for the Now playing bar (`strip`: the bar is not up, so a strip at the foot of the screen stands for it).
 */
function placeFor(r: DOMRect, strip: boolean, above: boolean, pop: HTMLElement) {
  const ring: Box = strip
    ? { left: r.left + 8, top: r.bottom - 52, width: Math.max(0, r.width - 16), height: 44 }
    : { left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6 };
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (above) {
    const left = Math.max(8, Math.min(ring.left + 16, vw - w - 8));
    return { ring, left, top: Math.max(8, ring.top - h - 12), arrow: Math.max(16, Math.min(w - 16, ring.left + 40 - left)) };
  }
  const left = Math.min(ring.left + ring.width + 12, vw - w - 8);
  const top = Math.max(8, Math.min(ring.top + ring.height / 2 - h / 2, vh - h - 8));
  return { ring, left, top, arrow: Math.max(14, Math.min(h - 14, ring.top + ring.height / 2 - top)) };
}
