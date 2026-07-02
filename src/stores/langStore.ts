// src/stores/langStore.ts
//
// 【設計意図】
// 表示言語(ja/en)のグローバル状態。src/hooks/useTheme.ts と同じ要領で
// localStorage に同期するが、useTheme の useState と違い zustand ストアにする。
// 理由：言語切替はテーマと違って複数箇所（MainLayoutのトグル・各画面の useT()）が
// 同じ状態を subscribe する必要があり、useState を上位に持ち上げてバケツリレーするより
// グローバルストアの方が自然（他のグローバル状態と同じ appStore/consultSessionStore の流儀に揃える）。

import { create } from "zustand";
import { KEYS } from "../lib/localData/localStore";
import type { Lang } from "../lib/i18n";

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(KEYS.LANG);
    return stored === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

export const useLangStore = create<LangState>((set, get) => ({
  lang: getInitialLang(),
  setLang: (lang) => {
    try { localStorage.setItem(KEYS.LANG, lang); } catch { /* 利用不可・容量不足は無視 */ }
    set({ lang });
  },
  toggleLang: () => {
    const next: Lang = get().lang === "ja" ? "en" : "ja";
    try { localStorage.setItem(KEYS.LANG, next); } catch { /* 利用不可・容量不足は無視 */ }
    set({ lang: next });
  },
}));
