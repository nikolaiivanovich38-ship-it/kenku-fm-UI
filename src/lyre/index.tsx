import React from "react";
import { createRoot } from "react-dom/client";

import { installDocumentDropGuard } from "../common/security/dragGuard";
import { AppProviders } from "./AppProviders";
import { SCREENS } from "./screens";
import { Shell } from "./shell/Shell";

import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/ui.css";
import "./styles/shell.css";

// SEC-7: a file dropped outside a drop zone must not replace this page.
installDocumentDropGuard(document);

createRoot(document.getElementById("root")).render(
  <AppProviders>
    <Shell screens={SCREENS} />
  </AppProviders>,
);
