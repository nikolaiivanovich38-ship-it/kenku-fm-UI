/**
 * A plain message while the library's own process is down (it restarts by itself after a crash) or cannot open the
 * library, from LyreApi's "library-status" events. When it is back, the message says so once, politely.
 */
import React, { useState } from "react";

import "./libraryStatus.css";

import { useLyreEvent } from "./hooks";

export function LibraryStatus() {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  useLyreEvent((event) => {
    if (event.type === "library-status") setStatus({ ok: event.ok, message: event.message });
  });
  if (!status) return null;
  return status.ok ? (
    <p className="lyre-library-status ok" role="status">
      {status.message}
    </p>
  ) : (
    <p className="lyre-library-status down" role="alert">
      {status.message}
    </p>
  );
}
