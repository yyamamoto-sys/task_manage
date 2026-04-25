// src/hooks/useTheme.ts
//
// 【設計意図】
// ライト/ダークモードの切り替えを管理するシンプルなフック。
// - localStorageに保存して再訪時も維持する
// - document.documentElement の data-theme 属性を切り替える
// - OSのカラースキーム設定を初期値として使用する

import { useState, useEffect, useCallback } from "react";
import { KEYS } from "../lib/localData/localStore";

export type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(KEYS.THEME) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  // OS設定に従う（未設定時）
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEYS.THEME, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => prev === "light" ? "dark" : "light");
  }, []);

  return { theme, toggle };
}
