// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { initializeLocalStore } from "./lib/localData/localStore";

// 初回起動時にシードデータを投入
initializeLocalStore();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
