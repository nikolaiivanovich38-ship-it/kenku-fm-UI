/**
 * Find missing files (route `relink`, DAT-8), ported from design/prototype/src/views/transfer.js: the tracks whose
 * files are not where the library expects them; Look in a folder (type it, choose it, or drop it on the page); a
 * table to confirm each file's new place with How sure (same name and size: ticked; same name, another size: not
 * ticked, with Preview; not found); Relink, with Undo. On the existing calls: findMissing, planRelink, applyRelink.
 */
import React, { useRef, useState } from "react";

import { isRefused, type RelinkPlan } from "../../../common/lyre/api";
import { useLyreApi, useMissingTracks } from "../../api";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { Column, Pane } from "../../kit/Pane";
import { PreviewButton } from "../../kit/SoundButtons";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { howSure, plural } from "./model";
import { focusSoon, pathOfDropped } from "./parts";
import "./transfer.css";
import { TopLead } from "../../shell/TopBar";

interface Row {
  trackId: string;
  title: string;
  /** Where it was found, or the files to choose from when there are several. */
  at: string;
  /** The address the found file plays from (Preview), or "" when nothing was found. */
  atUrl: string;
  candidates: string[];
  words: string;
  warn: boolean;
}

export function RelinkScreen() {
  const api = useLyreApi();
  const { say, toast } = useAnnounce();
  const { offer } = useUndoNote();
  const missing = useMissingTracks();
  const [folder, setFolder] = useState("");
  const [plan, setPlan] = useState<{ folder: string; rows: Row[] } | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const list = missing.data ?? [];

  const rowsOf = (p: RelinkPlan): Row[] => {
    const byId = new Map(list.map((m) => [m.id, m]));
    const rows: Row[] = [];
    for (const m of p.matches) {
      const how = howSure(m, byId.get(m.trackId));
      rows.push({ trackId: m.trackId, title: byId.get(m.trackId)?.title ?? m.trackId, at: m.to, atUrl: m.toUrl, candidates: [], words: how.words, warn: how.warn });
    }
    for (const a of p.ambiguous) rows.push({ trackId: a.trackId, title: byId.get(a.trackId)?.title ?? a.trackId, at: "", atUrl: "", candidates: a.candidates, words: "More than one file: choose which", warn: true });
    for (const id of p.notFound) rows.push({ trackId: id, title: byId.get(id)?.title ?? id, at: "", atUrl: "", candidates: [], words: "Not in that folder", warn: false });
    // In the order of the missing list, as the screen lists them.
    const order = new Map(list.map((m, i) => [m.id, i]));
    return rows.sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  };

  const look = async (source: { from: "choose-folder" } | { from: "path"; path: string }) => {
    if (busy) return;
    const from = document.activeElement;
    setBusy(true);
    try {
      const result = await api.import.planRelink(source);
      if (isRefused(result)) {
        toast(result.refusal.message);
        return;
      }
      const p = result.value;
      if (!p.folder) return;
      setFolder(p.folder);
      const rows = rowsOf(p);
      setPlan({ folder: p.folder, rows });
      setTicked(Object.fromEntries(p.matches.filter((m) => howSure(m, list.find((x) => x.id === m.trackId)).ticked).map((m) => [m.trackId, true])));
      setChosen({});
      setDone(null);
      const found = rows.filter((r) => r.at || r.candidates.length).length;
      say(`Found ${found} of ${rows.length} in ${p.folder}. Check the table, then Relink.`);
      // The next step: Relink, or the first file to tick when Lyre ticked none.
      focusSoon(bodyRef, "tf-relink", from);
    } finally {
      setBusy(false);
    }
  };
  // An empty box asks for the folder (Choose…), as the game master has nothing to type yet.
  const lookThere = (): void => void look(folder.trim() ? { from: "path", path: folder.trim() } : { from: "choose-folder" });

  const relinking = plan ? plan.rows.filter((r) => ticked[r.trackId] && (r.at || chosen[r.trackId])) : [];
  const relink = async () => {
    if (!plan || !relinking.length || busy) return;
    setBusy(true);
    try {
      const result = await api.import.applyRelink(relinking.map((r) => ({ trackId: r.trackId, to: r.at || chosen[r.trackId] })));
      if (isRefused(result)) {
        toast(result.refusal.message);
        return;
      }
      const words = `Relinked ${plural(result.value.relinked.length, "file")} to ${plan.folder}.`;
      setDone(words);
      setPlan(null);
      setTicked({});
      say(words);
      offer(words, result.undoLabel);
    } finally {
      setBusy(false);
    }
  };

  const notFound = plan ? plan.rows.filter((r) => !r.at && !r.candidates.length).length : 0;
  const found = plan ? plan.rows.length - notFound : 0;

  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>Find missing files</h1>
      </div>
      <div
        className="viewbody tf-body"
        ref={bodyRef}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          // A folder dropped on the page is looked in (its place on this computer comes from the preload).
          const file = e.dataTransfer?.files?.[0];
          if (!file) return;
          e.preventDefault();
          const path = pathOfDropped(file);
          setFolder(path);
          void look({ from: "path", path });
        }}
      >
        <div className="tf-cols tf-one">
          <Column>
            {done && (
              <p className="tf-done" role="status">
                <Icon name="check" size="s" />
                <span className="grow">{done}</span>
              </p>
            )}
            <Pane id="tf-missing" title="Missing files" icon="warn" kind="plain" noMax size="auto" status={list.length ? { text: plural(list.length, "file"), tone: "warn" } : { text: "None", tone: "idle" }}>
              {missing.data === undefined ? null : list.length ? (
                <table className="grid tf-table">
                  <caption className="sr-only">Missing files</caption>
                  <thead>
                    <tr>
                      <th scope="col">Track</th>
                      <th scope="col">File name</th>
                      <th scope="col">Was in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id}>
                        <td className="tf-cell" title={t.title}>
                          {t.title}
                        </td>
                        <td className="tf-cell" title={t.fileName}>
                          {t.fileName}
                        </td>
                        <td className="tf-cell" title={t.folder}>
                          {t.folder}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="tf-done">
                  <Icon name="check" size="s" />
                  Every file is where Lyre expects it.
                </p>
              )}
            </Pane>
            {(list.length > 0 || plan) && (
              <Pane id="tf-look" title="Look in a folder" icon="folder" kind="search" noMax size="auto" status={plan ? { text: `${found} found`, tone: "on" } : { text: "Ready", tone: "idle" }}>
                <div className="tf-lookrow">
                  <div className="field grow">
                    <label htmlFor="tf-folder">Look in this folder (and the folders inside it)</label>
                    <input
                      className="input"
                      id="tf-folder"
                      value={folder}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Type a folder, or choose one"
                      onChange={(e) => setFolder(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          lookThere();
                        }
                      }}
                    />
                  </div>
                  <Button icon="folder" onClick={() => void look({ from: "choose-folder" })} disabled={busy}>
                    Choose…
                  </Button>
                  <Button variant={plan ? undefined : "primary"} icon="search" onClick={lookThere} disabled={busy || !list.length}>
                    Look there
                  </Button>
                </div>
                <p className="hint">Lyre matches on the file name and its size, so a file with the same name from another album is not mixed up. You can also drop the folder on this page.</p>
                {plan && (
                  <>
                    <table className="grid tf-table tf-confirm">
                      <caption className="sr-only">What Lyre found in {plan.folder}</caption>
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="sr-only">Relink</span>
                          </th>
                          <th scope="col">Track</th>
                          <th scope="col">Found at</th>
                          <th scope="col">How sure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.map((r) => {
                          const can = !!(r.at || r.candidates.length);
                          return (
                            <tr key={r.trackId}>
                              <td>
                                {can && (
                                  <input type="checkbox" aria-label={`Relink ${r.title}`} data-focus={!relinking.length && r === plan.rows.find((x) => x.at || x.candidates.length) ? "tf-relink" : undefined} checked={!!ticked[r.trackId]} onChange={(e) => setTicked({ ...ticked, [r.trackId]: e.target.checked })} />
                                )}
                              </td>
                              <td className="tf-cell" title={r.title}>
                                {r.title}
                              </td>
                              <td className="tf-cell" title={r.at || undefined}>
                                {r.at ? (
                                  r.at
                                ) : r.candidates.length ? (
                                  <select className="input" aria-label={`Which file for ${r.title}`} value={chosen[r.trackId] ?? ""} onChange={(e) => {
                                    setChosen({ ...chosen, [r.trackId]: e.target.value });
                                    setTicked({ ...ticked, [r.trackId]: e.target.value !== "" });
                                  }}>
                                    <option value="">Choose a file</option>
                                    {r.candidates.map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="faint">–</span>
                                )}
                              </td>
                              <td>
                                <span className={cx("tf-how", r.warn && "warn")}>
                                  {r.warn && <Icon name="warn" size="s" />}
                                  {r.words}
                                </span>{" "}
                                {r.warn && r.atUrl && <PreviewButton target={{ kind: "track", id: r.trackId, file: r.atUrl }} name={`the file found for ${r.title}`} />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="tf-actrow">
                      <Button variant="primary" icon="link" onClick={() => void relink()} disabled={!relinking.length || busy} data-focus={relinking.length ? "tf-relink" : undefined}>
                        Relink {plural(relinking.length, "file")}
                      </Button>
                      {notFound > 0 && <span className="hint">{plural(notFound, "file")} not found there: try another folder after.</span>}
                    </div>
                  </>
                )}
              </Pane>
            )}
          </Column>
        </div>
      </div>
    </>
  );
}
