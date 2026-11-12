/**
 * What came across from Kenku FM (route `moved`), ported from design/prototype/src/views/transfer.js: what Lyre copied
 * on its first start and where it is now, the files it cannot find (Find them… opens Find missing files), and what it
 * did not bring across. Read from `transfer.movedReport()`; a library that started in Lyre says so.
 *
 * 0.5.1 (FND-16, design/prototype/ROUND8.md §5): website tabs are gone from Lyre (Nik, 11 Nov: "Keep the code, remove
 * them from the interface"), so the old bookmarks are listed once, each with Copy; no bookmarks, no box. Also what
 * the old player gained after the first start and came across on the first start of 0.5.1, and the tracks that are
 * only a web address, which Lyre cannot play (both shown only when there are some).
 */
import React from "react";

import type { MoveReport } from "../../../common/lyre/api";
import { useAnnounce } from "../../shell/Announcer";

import { useLyreQuery } from "../../api";
import { copyText } from "../../kit/copyText";
import { Icon } from "../../kit/Icon";
import { Column, Pane } from "../../kit/Pane";
import { hashOf } from "../../shell/routes";
import { plural } from "./model";
import "./transfer.css";
import { TopLead } from "../../shell/TopBar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "5 Nov 2026 at 18:42", in this computer's time. */
function whenWords(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} at ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function MovedScreen() {
  const report = useLyreQuery("moved-report", (api) => api.transfer.movedReport(), ["tracks"]);
  const head = (
    <div className="viewhead">
      <TopLead />
      <h1>What came across from Kenku FM</h1>
    </div>
  );
  if (report.data === undefined) return head;
  const m = report.data;
  if (m === null) {
    return (
      <>
        {head}
        <div className="viewbody tf-body" data-scroll="body">
          <p className="empty">Nothing came across from Kenku FM: this library started in Lyre.</p>
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="viewbody tf-body" data-scroll="body">
        <div className="tf-cols">
          <Column>
            <Pane id="tf-what" title="What came across" icon="check" kind="plain" noMax size="auto" status={{ text: "Copied", tone: "idle" }}>
              <p className="tf-lead">
                On {whenWords(m.at)} Lyre copied your {m.from} library. Kenku FM&apos;s own copy is untouched, so you can still open it.
              </p>
              <table className="grid tf-table">
                <caption className="sr-only">What came across</caption>
                <thead>
                  <tr>
                    <th scope="col">In Kenku FM</th>
                    <th scope="col" className="num">
                      How many
                    </th>
                    <th scope="col">Now in Lyre</th>
                  </tr>
                </thead>
                <tbody>
                  {m.copied.map((row) => (
                    <tr key={row.what}>
                      <td>{row.what}</td>
                      <td className="num">{row.count}</td>
                      <td>{row.route ? <a href={row.route.startsWith("#") ? row.route : hashOf(row.route)}>{row.nowIn}</a> : row.nowIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Pane>
            {m.bookmarks.length > 0 && <BookmarksPane bookmarks={m.bookmarks} />}
            {m.later && (
              <Pane id="tf-later" title="Brought in since" icon="plus" kind="plain" noMax size="auto">
                <p className="tf-lead">On {whenWords(m.later.at)} Lyre brought in what was new in the old player since your first start.</p>
                {m.later.lines.map((line) => (
                  <p key={line} className="tf-lead">
                    {line}
                  </p>
                ))}
              </Pane>
            )}
          </Column>
          <Column>
            {m.webOnly.length > 0 && (
              <Pane id="tf-web" title="Tracks Lyre cannot play" icon="warn" kind="plain" noMax size="auto" status={{ text: plural(m.webOnly.length, "track"), tone: "warn" }}>
                <p className="tf-lead">Each of these is only a web address. Lyre plays files on this computer: download each one, then add the file to your library.</p>
                <ul className="list tf-bm" aria-label="Tracks that are only a web address">
                  {m.webOnly.map((t) => (
                    <li key={t.id} className="lrow">
                      <span className="grow tf-iname">
                        <b className="ellipsis" title={t.title}>
                          {t.title}
                        </b>
                        <span className="hint ellipsis tf-url" title={t.url}>
                          {t.url}
                        </span>
                      </span>
                      <CopyAddress url={t.url} name={t.title} />
                    </li>
                  ))}
                </ul>
              </Pane>
            )}
            <Pane id="tf-miss" title="Files Lyre cannot find" icon="warn" kind="plain" noMax size="auto" status={m.missing.length ? { text: plural(m.missing.length, "file"), tone: "warn" } : { text: "None", tone: "idle" }}>
              {m.missing.length ? (
                <>
                  <ul className="list tf-miss" aria-label="Files Lyre cannot find">
                    {m.missing.map((t) => (
                      <li key={t.id} className="lrow">
                        <span className="grow tf-iname">
                          <b className="ellipsis">{t.title}</b>
                          <span className="hint ellipsis" title={t.path}>
                            {t.fileName} · was in {t.folder}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="tf-actrow">
                    <a className="btn primary" href={hashOf("relink")}>
                      <Icon name="folder" size="s" />
                      Find them…
                    </a>
                  </div>
                </>
              ) : (
                <p className="tf-done">
                  <Icon name="check" size="s" />
                  Every file is where Lyre expects it.
                </p>
              )}
            </Pane>
            <Pane id="tf-not" title="Not brought across" icon="close" kind="plain" noMax size="auto" status={{ text: String(m.notBrought.length), tone: "idle" }}>
              <ul className="list tf-not">
                {m.notBrought.map((x) => (
                  <li key={x.what} className="lrow">
                    <span className="grow tf-iname">
                      <b>{x.what}</b>
                      <span className="hint">{x.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Pane>
          </Column>
        </div>
      </div>
    </>
  );
}

/** Copy an address, saying so (or plainly that it could not). */
function CopyAddress({ url, name }: { url: string; name: string }) {
  const { toast } = useAnnounce();
  return (
    <button
      type="button"
      className="btn s ghost"
      aria-label={`Copy the address of ${name}`}
      onClick={() => {
        void copyText(url).then((copied) => toast(copied ? `Copied: ${url}` : "Lyre could not copy it. Select the address and copy it yourself."));
      }}
    >
      Copy
    </button>
  );
}

/** FND-16 (ROUND8.md §5): the old window's bookmarks, listed once to copy into a browser. */
function BookmarksPane({ bookmarks }: { bookmarks: MoveReport["bookmarks"] }) {
  return (
    <Pane id="tf-bm" title="Bookmarks" icon="link" kind="plain" noMax size="auto">
      <p className="tf-lead">Websites can&apos;t be opened in Lyre for now. Copy an address to open it in your browser.</p>
      <ul className="list tf-bm" aria-label="Bookmarks from Kenku FM">
        {bookmarks.map((b, i) => (
          <li key={`${i} ${b.url}`} className="lrow">
            <span className="grow tf-iname">
              <b className="ellipsis" title={b.folder ? `${b.title} (in ${b.folder})` : b.title}>
                {b.title}
              </b>
              <span className="hint ellipsis tf-url" title={b.url}>
                {b.url}
              </span>
            </span>
            <CopyAddress url={b.url} name={b.title} />
          </li>
        ))}
      </ul>
    </Pane>
  );
}
