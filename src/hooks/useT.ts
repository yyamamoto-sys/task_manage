// src/hooks/useT.ts
//
// 【設計意図】
// 現在の表示言語（stores/langStore.ts）に紐づいた t() 関数を返すフック。
// lang を selector で subscribe するため、言語切替でこのフックを使う
// コンポーネントは自動的に再レンダーされる。
//
// 🔴 v3.135：返す関数は lang が変わったときだけ別物になる（useCallback）。
// 描画ごとに別の関数を返していた v3.134 までは、t を依存に持つ取得の effect が描画のたびに
// 再実行され、取得完了の setState → 再描画 → 再取得と止まらなくなった（v3.133 のベル。CLAUDE.md Section 69）。

import { useCallback } from "react";
import { useLangStore } from "../stores/langStore";
import { translate } from "../lib/i18n";

export function useT() {
  const lang = useLangStore(s => s.lang);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
}
