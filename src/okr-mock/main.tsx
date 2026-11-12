import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/globals.css";
import "./mock.css";
import "./mock4.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
