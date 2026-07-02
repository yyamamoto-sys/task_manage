// src/lib/i18n.ts
//
// 【設計意図】
// 軽量自前i18nの仕組み（react-i18next等の依存は追加しない。docs/dev/i18n-plan.md 決定事項）。
// モジュールごとの辞書（src/i18n/<module>.ts）をここで束ねて t(key) で引く。
// キー命名規約：<module>.<area>.<name>（例：auth.login.title）。
//
// 実際に画面から使うときは stores/langStore.ts の現在言語と組み合わせた
// hooks/useT.ts の useT() フックを使う（このファイルは lang を明示的に渡す純関数のみ）。

import { commonJa, commonEn } from "../i18n/common";
import { authJa, authEn } from "../i18n/auth";

export type Lang = "ja" | "en";

// 辞書はモジュールごとに分割し、ここで束ねる（高凝集・モジュール化）。
// 新しいモジュールの辞書を追加するときはここに1行足すだけでよい。
const DICT: Record<Lang, Record<string, string>> = {
  ja: { ...commonJa, ...authJa },
  en: { ...commonEn, ...authEn },
};

// 同じ警告を連呼しないための既出キー記録（開発中のコンソール汚染防止）
const warnedMissingKey = new Set<string>();
const warnedMissingLangValue = new Set<string>();

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 【設計意図】
 * key に対応する現在言語の文字列を返す。
 * - 現在言語に無ければ ja にフォールバックする
 * - ja にも無ければ key 自体を返す（画面が壊れないようにするため）
 * - どちらのケースも console.warn で開発中に気付けるようにする
 * - vars を渡すと "{name}" 形式のプレースホルダを差し込む
 */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const value = DICT[lang]?.[key];
  if (value !== undefined) return interpolate(value, vars);

  const fallback = DICT.ja[key];
  if (fallback !== undefined) {
    if (lang !== "ja" && !warnedMissingLangValue.has(`${lang}:${key}`)) {
      warnedMissingLangValue.add(`${lang}:${key}`);
      console.warn(`[i18n] "${key}" has no "${lang}" translation. Falling back to "ja".`);
    }
    return interpolate(fallback, vars);
  }

  if (!warnedMissingKey.has(key)) {
    warnedMissingKey.add(key);
    console.warn(`[i18n] missing translation key: "${key}"`);
  }
  return key;
}
