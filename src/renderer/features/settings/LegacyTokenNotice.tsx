import React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";

/** Where bot tokens are reset. Opened in the system browser (https links only, SEC-10). */
const DEVELOPER_PORTAL = "https://discord.com/developers/applications";

/**
 * WP1 review 11: shown in the message box when a token moved over from an
 * older version cannot be saved encrypted on this computer.
 */
export const LEGACY_TOKEN_SESSION_ONLY =
  "Your Discord bot token from the older version is kept only until Lyre closes, because this computer has no secure place to save it. Next time, enter it again in Settings.";

/**
 * WP1 review 4: a one-time note in Settings after a token saved by an older
 * version was moved. Older versions saved it unprotected, and a copy can stay
 * in the app's storage files after the move, so a new token is the only
 * certain fix.
 */
export function LegacyTokenNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    // A standing note, not an alert: error messages own role="alert".
    <Alert
      severity="info"
      variant="outlined"
      role="note"
      action={
        <Button color="inherit" size="small" onClick={onDismiss}>
          Got it
        </Button>
      }
    >
      Lyre moved your bot token from an older version, which saved it unprotected on this computer. To be safe,
      reset the token in the{" "}
      <Link href={DEVELOPER_PORTAL} target="_blank" rel="noopener noreferrer">
        Discord Developer Portal
      </Link>{" "}
      (your bot&apos;s Bot page, &quot;Reset Token&quot;) and enter the new one here.
    </Alert>
  );
}
