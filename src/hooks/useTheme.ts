// src/hooks/useTheme.ts
//
// 【設計意図】
// ライト/ダークモードの切り替えを管理するシンプルなフック。
// - localStorageに保存して再訪時も維持する
// - document.documentElement の data-theme 属性を切り替える
// - 初回ログイン（未設定時）は常にライトモード固定。OSのダークモード設定は見ない
//   （初見のツアー・ガイド等のトンマナ確認をライトモード基準で揃えるため）。
//   一度でも手動で切り替えた人は、以後 localStorage の値をそのまま尊重する。

import { useState, useEffect, useCallback } from "react";
import { KEYS } from "../lib/localData/localStore";

export type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(KEYS.THEME) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  // 未設定（初回ログイン）は常にライトモード
  return "light";
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
