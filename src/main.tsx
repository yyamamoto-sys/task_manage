// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { migrateLocalStorage } from "./lib/localData/localStore";
import { getClientErrorScreen, installClientErrorLogging } from "./lib/errors/clientErrorLog";
import { canLogClientError, logClientError } from "./lib/supabase/clientErrorStore";
import { APP_VERSION } from "./lib/version";
import "./styles/globals.css";

// React マウント前に localStorage スキーマを移行する
migrateLocalStorage();

// 画面に出たエラーを super_admin 向けに記録する（CLAUDE.md Section 67）。React の外で取り付けるのは、
// ErrorBoundary が App ごと置き換えた後のクラッシュも拾うため。開発サーバーでは既定で送らない。
if (!import.meta.env.DEV || import.meta.env.VITE_LOG_CLIENT_ERRORS_IN_DEV === "1") {
  installClientErrorLogging({
    send: logClientError,
    canSend: canLogClientError,
    env: () => ({
      route: window.location.pathname,
      screen: getClientErrorScreen(),
      appVersion: APP_VERSION,
      userAgent: navigator.userAgent,
    }),
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
