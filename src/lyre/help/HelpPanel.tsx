/**
 * FND-8: Help's side panel (design/prototype/HELP.md, views/help.js): a search box, the articles grouped by task,
 * an article with Back, and at its foot Take the tour and Save diagnostics… (FND-9). It sits beside the screen on the
 * side-panel host (round 10; below 760 px of window it takes the whole window), so an article's steps can be followed
 * while it is open.
 * It is a landmark, not a modal dialog: the screen beside it keeps working.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../kit/Button";
import { Icon } from "../kit/Icon";
import { SearchField } from "../kit/Fields";
import { useAnnounce } from "../shell/Announcer";
import { ARTICLES, HELP_GROUPS, searchArticles, type HelpArticle } from "./articles";
import { HelpText } from "./HelpText";
import { keepKeysHere } from "./keys";
import { diagnosticsResultWords, type DiagnosticsBridge, type DiagnosticsResult } from "../../common/lyreDiagnostics";
import { LYRE_VERSION } from "../version";
import { SCREEN_HELP, type TourKey, type TourPlaces } from "./tours";
import { useSetupProgress } from "./setup";
import { routeFromHash } from "../shell/routes";
import { useHasLyreApi, useBoards, useCampaigns, useTracks } from "../api";
import "./help.css";

/** Count announced this long after the last key, so a screen reader is not interrupted at every letter. */
const COUNT_DELAY_MS = 400;

export interface HelpPanelProps {
  onClose: () => void;
  onTour: () => void;
  /** Round 10: Tour of this screen and Set up Lyre's Show me. */
  onScreenTour?: (key: TourKey, places: TourPlaces | "here") => void;
  /** The main process's Save diagnostics (window.lyre.diagnostics); null where there is none (tests, a browser). */
  diagnostics: DiagnosticsBridge | null;
}

export function HelpPanel({ onClose, onTour, onScreenTour, diagnostics }: HelpPanelProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<HelpArticle | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Where focus goes after a change of view: the article's title, or the article Back came from. */
  const focusNext = useRef<string | null>(null);
  const { say } = useAnnounce();

  useEffect(() => searchRef.current?.focus(), []);
  useLayoutEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    focusNext.current = null;
    bodyRef.current?.querySelector<HTMLElement>(`[data-help="${key}"]`)?.focus();
  });

  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      const n = searchArticles(query).length;
      say(n === 0 ? "Nothing found" : `${n} ${n === 1 ? "article" : "articles"}`);
    }, COUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, say]);

  const show = (article: HelpArticle) => {
    focusNext.current = "title";
    setOpen(article);
    bodyRef.current?.scrollTo?.({ top: 0 });
  };
  const back = () => {
    focusNext.current = open ? `item-${open.id}` : null;
    setOpen(null);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    keepKeysHere(event);
    if (event.key !== "Escape" || event.shiftKey || event.defaultPrevented) return;
    event.preventDefault();
    if (event.target === searchRef.current && query) setQuery("");
    else onClose();
  };

  const item = (article: HelpArticle) => (
    <li key={article.id}>
      <button type="button" className="help-item" data-help={`item-${article.id}`} onClick={() => show(article)}>
        {article.title}
      </button>
    </li>
  );
  let body: React.ReactNode;
  if (open) {
    body = (
      <>
        <Button variant="ghost" size="s" icon="back" className="help-back" onClick={back}>
          Back
        </Button>
        <article className="help-article" aria-labelledby="help-article-title">
          <h3 id="help-article-title" tabIndex={-1} data-help="title">
            {open.title}
          </h3>
          <HelpText body={open.body} />
        </article>
      </>
    );
  } else if (query.trim()) {
    const found = searchArticles(query);
    body = found.length ? (
      <ul className="help-list" aria-label="Found">
        {found.map(item)}
      </ul>
    ) : (
      <p className="muted help-none">Nothing found. Try other words.</p>
    );
  } else {
    body = (
      <>
        {onScreenTour && <HelpTop onScreenTour={onScreenTour} item={item} />}
        {HELP_GROUPS.map((group, i) => (
      <React.Fragment key={group}>
        <h3 className="help-group" id={`help-group-${i}`}>
          {group}
        </h3>
        <ul className="help-list" aria-labelledby={`help-group-${i}`}>
          {ARTICLES.filter((a) => a.group === group).map(item)}
        </ul>
      </React.Fragment>
        ))}
      </>
    );
  }

  return (
    <aside id="lyre-help" className="helpsheet" aria-labelledby="help-title" onKeyDown={onKeyDown}>
      <header className="help-head">
        <h2 id="help-title">Help</h2>
        <button type="button" className="closer" aria-label="Close help" title="Close help (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <SearchField
        className="help-search"
        label="Search help"
        placeholder="Search help"
        value={query}
        inputRef={searchRef}
        onChange={(value) => {
          setQuery(value);
          setOpen(null);
        }}
      />
      <div className="help-body" ref={bodyRef}>
        {body}
      </div>
      <HelpFoot onTour={onTour} diagnostics={diagnostics} />
    </aside>
  );
}

function HelpFoot({ onTour, diagnostics }: Pick<HelpPanelProps, "onTour" | "diagnostics">) {
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const { say } = useAnnounce();
  const showRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setResult(null);
    let answer: DiagnosticsResult;
    try {
      answer = diagnostics ? await diagnostics.save() : { ok: false, cancelled: false, message: "this window cannot save files." };
    } catch {
      answer = { ok: false, cancelled: false, message: "Lyre could not write the file. Try another folder." };
    }
    if (!mounted.current) return;
    setSaving(false);
    setResult(answer);
    const words = diagnosticsResultWords(answer);
    if (words) say(words);
  };
  useEffect(() => {
    if (result?.ok) showRef.current?.focus();
  }, [result]);
  const words = result && diagnosticsResultWords(result);

  return (
    <footer className="help-foot">
      <div className="help-foot-btns">
        <Button size="s" icon="play" onClick={onTour}>
          Take the tour
        </Button>
        <Button size="s" icon="download" onClick={() => void save()} disabled={saving} aria-busy={saving || undefined}>
          {saving ? "Saving…" : "Save diagnostics…"}
        </Button>
      </div>
      {words && (
        <div className="help-result">
          <Icon name={result?.ok ? "check" : "warn"} size="s" />
          <span className="grow">{words}</span>
          {result?.ok && (
            <Button ref={showRef} variant="ghost" size="s" onClick={() => diagnostics?.show()}>
              Show in folder
            </Button>
          )}
        </div>
      )}
      {/* 0.5.1 (ROUND8.md §2): Lyre's version at Help's foot, as at the top right of Settings. */}
      {LYRE_VERSION && (
        <p className="help-ver">
          Lyre{" "}
          <span className="num" title="Lyre version">
            {LYRE_VERSION}
          </span>
        </p>
      )}
    </footer>
  );
}

/**
 * Round 9 §4 and round 10 (ROUND10.md "Help"): Help starts with On this screen (Tour of this screen and the screen's
 * article), then Set up Lyre (with a library to read).
 */
function HelpTop({ onScreenTour, item }: { onScreenTour: (key: TourKey, places: TourPlaces | "here") => void; item: (article: HelpArticle) => React.ReactNode }) {
  const route = routeFromHash(window.location.hash);
  const here = SCREEN_HELP[route.name];
  const article = here?.article ? ARTICLES.find((a) => a.id === here.article) : undefined;
  return (
    <>
      {here && (
        <div className="help-screen">
          <h3 className="help-group">On this screen</h3>
          <div className="help-screen-row">
            <Button size="s" icon="play" onClick={() => onScreenTour(here.tour, "here")}>
              Tour of this screen
            </Button>
          </div>
          {article && (
            <ul className="help-list" aria-label="On this screen">
              {item(article)}
            </ul>
          )}
        </div>
      )}
      {useHasLyreApi() && <SetUpLyre onShowMe={(key, places) => onScreenTour(key, places)} />}
    </>
  );
}

/** Set up Lyre: nine tasks ticked from the library, each with Show me; one line once all are done or it is hidden. */
function SetUpLyre({ onShowMe }: { onShowMe: (key: TourKey, places: TourPlaces) => void }) {
  const progress = useSetupProgress(themeWasChosen());
  const tracks = useTracks().data ?? [];
  const campaigns = useCampaigns().data ?? [];
  const boards = useBoards().data ?? [];
  const [showDone, setShowDone] = useState(false);
  const all = progress.done === progress.of;
  const folded = progress.hidden || (all && !showDone);
  const untagged = tracks.find((t) => !Object.values(t.tags).some((x) => x.length)) ?? tracks[0];
  const campaign = campaigns[0];
  const session = campaign?.sessions.find((s) => s.status !== "played") ?? campaign?.sessions[0];
  const places: TourPlaces = {
    trackId: untagged?.id,
    session: campaign && session ? { campaignId: campaign.id, sessionId: session.id } : undefined,
    boardId: boards[0]?.id,
  };
  return (
    <section className="help-setup" aria-labelledby="help-setup-h">
      <div className="help-setup-head">
        <h3 className="help-group" id="help-setup-h">
          Set up Lyre
        </h3>
        <span className="num faint">{all ? "all done" : `${progress.done} of ${progress.of}`}</span>
        <span className="grow" />
        <Button
          size="s"
          variant="ghost"
          aria-expanded={!folded}
          onClick={() => (all && !progress.hidden ? setShowDone(!showDone) : progress.setHidden(!progress.hidden))}
        >
          {folded ? "Show" : "Hide"}
        </Button>
      </div>
      {!folded && (
        <>
          <div className="help-setup-bar" role="progressbar" aria-label="Set up Lyre" aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={progress.done}>
            <span style={{ width: `${Math.round((progress.done / progress.of) * 100)}%` }} />
          </div>
          <ol className="help-setup-list">
            {progress.tasks.map(({ task, done }, i) => (
              <li key={task.id} className={done ? "done" : undefined}>
                <span className="help-setup-mark" aria-hidden="true">
                  {done ? <Icon name="check" size="s" /> : i + 1}
                </span>
                <span className="grow">
                  {task.title}
                  <span className="sr-only">{done ? ", done" : ", to do"}</span>
                </span>
                <Button size="s" variant={done ? "ghost" : undefined} aria-label={`${done ? "Show me again" : "Show me"}: ${task.title}`} onClick={() => onShowMe(task.tour, places)}>
                  {done ? "Show me again" : "Show me"}
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** "Choose a theme (optional)": a theme was chosen in Look and feel at some time (it is remembered). */
function themeWasChosen(): boolean {
  try {
    return /"theme"/.test(localStorage.getItem("lyre-shell") ?? "");
  } catch {
    return false;
  }
}
