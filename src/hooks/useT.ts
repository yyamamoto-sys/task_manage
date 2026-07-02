// src/hooks/useT.ts
//
// 【設計意図】
// 現在の表示言語（stores/langStore.ts）に紐づいた t() 関数を返すフック。
// lang を selector で subscribe するため、言語切替でこのフックを使う
// コンポーネントは自動的に再レンダーされる。

import { useLangStore } from "../stores/langStore";
import { translate } from "../lib/i18n";

export function useT() {
  const lang = useLangStore(s => s.lang);
  return (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
