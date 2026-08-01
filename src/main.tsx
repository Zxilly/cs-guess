import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { BrowserRouter } from "react-router";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { i18n, initializeLocale } from "./i18n.ts";
import "./index.css";

initializeLocale();

async function renderApp() {
  const { App } = await import("./App.tsx");

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <TooltipProvider delayDuration={0} disableHoverableContent>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
}

if (import.meta.env.DEV) {
  void Promise.all([
    import("./debug/install-audit-state.ts"),
    import("./debug/install-debug-tool.ts"),
  ]).then(async ([{ installAuditState }, { installDebugTool }]) => {
    await installAuditState();
    installDebugTool();
    void renderApp();
  });
} else {
  void renderApp();
}
