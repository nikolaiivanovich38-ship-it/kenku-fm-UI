import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";

/**
 * App-wide plain-language messages for the player window (import summaries,
 * playback errors). Shown one at a time in a Snackbar; the Alert has
 * role="alert", so screen readers announce each message when it appears.
 */

export type NotificationSeverity = "success" | "info" | "warning" | "error";

export type Notification = {
  severity: NotificationSeverity;
  message: string;
};

export type Notify = (notification: Notification) => void;

/** How long each kind of message stays up; errors stay longer to be read. */
export const NOTIFICATION_DURATION_MS: Record<NotificationSeverity, number> = {
  success: 6000,
  info: 6000,
  warning: 10000,
  error: 10000,
};

type QueuedNotification = Notification & { key: number };

const NotifyContext = createContext<Notify | null>(null);

/** Holds the message queue and renders the current message. */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedNotification[]>([]);
  const [open, setOpen] = useState(true);

  const notify = useCallback<Notify>((notification) => {
    if (!notification.message) {
      return;
    }
    setQueue((current) => [
      ...current,
      { ...notification, key: Date.now() + Math.random() },
    ]);
  }, []);

  const current = queue[0];

  function handleClose(_event?: unknown, reason?: string) {
    // A click elsewhere should not dismiss a message before it is read.
    if (reason === "clickaway") {
      return;
    }
    setOpen(false);
  }

  function handleExited() {
    setQueue((current) => current.slice(1));
    setOpen(true);
  }

  const value = useMemo(() => notify, [notify]);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.key}
        open={Boolean(current) && open}
        autoHideDuration={
          current ? NOTIFICATION_DURATION_MS[current.severity] : null
        }
        onClose={handleClose}
        TransitionProps={{ onExited: handleExited }}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        {current ? (
          <Alert
            severity={current.severity}
            onClose={() => handleClose()}
            sx={{ width: "100%", maxWidth: 560 }}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotifyContext.Provider>
  );
}

/**
 * Returns `notify`. Outside a NotificationProvider (isolated component tests)
 * messages go to the console instead of being lost silently.
 */
export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  return notify ?? logNotification;
}

function logNotification({ severity, message }: Notification) {
  if (severity === "error") {
    console.error(message);
  } else {
    console.info(message);
  }
}
