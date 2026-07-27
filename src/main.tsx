import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { installDebugTool } from "./debug/install-debug-tool.ts";
import "./index.css";

installDebugTool();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
