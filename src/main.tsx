import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/saira-condensed/latin-ext-600.css";
import "@fontsource/saira-condensed/latin-ext-800.css";
import "@fontsource/newsreader/latin-ext-400.css";
import "@fontsource/newsreader/latin-ext-400-italic.css";
import "@fontsource/newsreader/latin-ext-600.css";
import "@fontsource/ibm-plex-mono/latin-ext-500.css";
import "@fontsource/saira-condensed/latin-600.css";
import "@fontsource/saira-condensed/latin-800.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
