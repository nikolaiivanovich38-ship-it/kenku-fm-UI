import React from "react";
import { createRoot } from "react-dom/client";

// The shared styles first, so each screen's own CSS (imported with the screens) wins ties with ui.css.
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/ui.css";
import "./styles/shell.css";

import { installDocumentDropGuard } from "../common/security/dragGuard";
import { AppProviders } from "./AppProviders";
import { SCREENS } from "./screens";
import { Shell } from "./shell/Shell";

// SEC-7: a file dropped outside a drop zone must not replace this page.
installDocumentDropGuard(document);

createRoot(document.getElementById("root")).render(
  <AppProviders>
    <Shell screens={SCREENS} firstRunTour />
  </AppProviders>,
);
