import React from "react";

/**
 * A screen that is not built yet: its heading and a plain note. Wave 3's screen streams replace these one by one
 * (src/lyre/screens/<screen>/, registered in src/lyre/screens/index.tsx).
 */
export function PlaceholderScreen({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="viewhead">
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

/** Where Live and its buttons (Run, Go to Live, the Prep | Live switch) lead until Live is built in Lyre 0.4. */
export const LIVE_COMES_LATER = "Live comes in Lyre 0.4. Until then, run your session from the Player tab.";

/** Live and Outputs until Lyre 0.4: what is coming and where to run a session meanwhile, in plain words. */
export function ComingScreen({ title }: { title: string }) {
  return (
    <>
      <div className="viewhead">
        <h1>{title}</h1>
      </div>
      <div className="viewbody">
        <div className="placeholder">
          <p>{LIVE_COMES_LATER}</p>
        </div>
      </div>
    </>
  );
}

