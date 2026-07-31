import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import "./index.css";

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </React.StrictMode>,
  );
}

if (import.meta.env.DEV) {
  void Promise.all([
    import("./debug/install-audit-state.ts"),
    import("./debug/install-debug-tool.ts"),
  ]).then(([{ installAuditState }, { installDebugTool }]) => {
    installAuditState();
    installDebugTool();
    renderApp();
  });
} else {
  renderApp();
}
