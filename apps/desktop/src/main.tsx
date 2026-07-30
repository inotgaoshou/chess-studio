import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyColorTheme, initialColorTheme } from "./theme";
import "./styles.css";
import "./sync.css";

const isTauri = "__TAURI_INTERNALS__" in window;
applyColorTheme(initialColorTheme(isTauri ? "desktop" : "web"));

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

if (!isTauri && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
