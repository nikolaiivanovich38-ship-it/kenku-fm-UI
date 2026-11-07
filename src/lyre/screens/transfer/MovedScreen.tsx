/**
 * What came across from Kenku FM (route `moved`), ported from design/prototype/src/views/transfer.js: what Lyre copied
 * on its first start and where it is now, the files it cannot find (Find them… opens Find missing files), and what it
 * did not bring across. Read from `transfer.movedReport()`; a library that started in Lyre says so.
 */
import React from "react";

import { useLyreQuery } from "../../api";
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
        <div className="viewbody tf-body">
          <p className="empty">Nothing came across from Kenku FM: this library started in Lyre.</p>
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="viewbody tf-body">
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
          </Column>
          <Column>
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
