import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { installDebugTool } from "./debug/install-debug-tool.ts";
import { installAuditState } from "./debug/install-audit-state.ts";
import "./index.css";

installAuditState();
installDebugTool();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </TooltipProvider>
  </React.StrictMode>,
);
