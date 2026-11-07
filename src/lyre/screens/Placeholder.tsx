import React from "react";
import { TopLead } from "../shell/TopBar";

/**
 * A screen that is not built yet: its heading and a plain note. Wave 3's screen streams replace these one by one
 * (src/lyre/screens/<screen>/, registered in src/lyre/screens/index.tsx).
 */
export function PlaceholderScreen({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>{title}</h1>
      </div>
      <div className="viewbody">
        <div className="placeholder">
          <p className="empty">Not built yet.</p>
          {children}
        </div>
      </div>
    </>
  );
}
