// src/stores/langStore.ts
//
// 【設計意図】
// 表示言語(ja/en)のグローバル状態。src/hooks/useTheme.ts と同じ要領で
// localStorage に同期するが、useTheme の useState と違い zustand ストアにする。
// 理由：言語切替はテーマと違って複数箇所（MainLayoutのトグル・各画面の useT()）が
// 同じ状態を subscribe する必要があり、useState を上位に持ち上げてバケツリレーするより
// グローバルストアの方が自然（他のグローバル状態と同じ appStore/consultSessionStore の流儀に揃える）。
//
// 【en辞書の動的import対応（v3.19）】
// en は lib/i18n.ts の loadEnDict() で動的importする設計にしたため、
// 「lang を en にする」操作は非同期になった。ここが唯一の変更点で、呼び出し側
// （LangToggle等）から見たAPI（setLang/toggleLang）自体は変えていない。
// 【重要な制約】en辞書が未ロードのまま lang="en" にすると、translate() が全キーで
// ja フォールバック＋大量の console.warn を出してしまう（lib/i18n.ts参照）。
// そのため setLangInternal は「loadEnDict() が解決してから lang state を en にする」
// 順序を必ず守る。ロード中は isLoadingEn=true にし、LangToggle がスピナーを出す。
// ロード失敗時は ja のまま留まり、Toast でユーザーに通知する。

import { create } from "zustand";
import { KEYS } from "../lib/localData/localStore";
import type { Lang } from "../lib/i18n";
import { loadEnDict } from "../lib/i18n";
import { showToast } from "../components/common/Toast";

function getStoredLangPreference(): Lang {
  try {
    const stored = localStorage.getItem(KEYS.LANG);
    return stored === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}

interface LangState {
  lang: Lang;
  /** en辞書を動的import中かどうか。LangToggleがスピナー表示に使う */
  isLoadingEn: boolean;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

type SetFn = (partial: Partial<LangState>) => void;
type GetFn = () => LangState;

async function setLangInternal(lang: Lang, set: SetFn, get: GetFn): Promise<void> {
  if (lang === get().lang) return;

  if (lang === "ja") {
    try { localStorage.setItem(KEYS.LANG, "ja"); } catch { /* 利用不可・容量不足は無視 */ }
    set({ lang: "ja" });
    return;
  }

  // lang === "en"：ロード完了までlang stateは変えない（未ロードのenを表示させないため）
  if (get().isLoadingEn) return; // 二重クリック防止
  set({ isLoadingEn: true });
  try {
    await loadEnDict();
    try { localStorage.setItem(KEYS.LANG, "en"); } catch { /* 利用不可・容量不足は無視 */ }
    set({ lang: "en", isLoadingEn: false });
  } catch {
    set({ isLoadingEn: false });
    showToast("英語データの読み込みに失敗しました。もう一度お試しください。", "error");
  }
}

export const useLangStore = create<LangState>((set, get) => ({
  lang: "ja",
  isLoadingEn: false,
  setLang: (lang) => { void setLangInternal(lang, set, get); },
  toggleLang: () => { void setLangInternal(get().lang === "ja" ? "en" : "ja", set, get); },
}));

// 起動直後：前回 en を選んでいた場合は、黙って読み込みだけ開始する
// （lang stateは読み込み完了までjaのまま→表示上は一瞬jaが見えるが、
// 「未ロードのenを表示する」より安全。読み込みが終わり次第自動でenに切り替わる）。
if (getStoredLangPreference() === "en") {
  void useLangStore.getState().setLang("en");
}
