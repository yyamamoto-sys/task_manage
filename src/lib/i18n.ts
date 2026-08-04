// src/lib/i18n.ts
//
// 【設計意図】
// 軽量自前i18nの仕組み（react-i18next等の依存は追加しない。docs/dev/i18n-plan.md 決定事項）。
// モジュールごとの辞書（src/i18n/<module>.ja.ts / <module>.en.ts）をここで束ねて t(key) で引く。
// キー命名規約：<module>.<area>.<name>（例：auth.login.title）。
//
// 実際に画面から使うときは stores/langStore.ts の現在言語と組み合わせた
// hooks/useT.ts の useT() フックを使う（このファイルは lang を明示的に渡す純関数のみ）。
//
// 【ja/en分割・ダウンロード量最小化（v3.19）】
// ja は既定言語・必ず必要なため静的import。en は動的import(loadEnDict())にして、
// 英語を使わないユーザーには一切ダウンロードさせない。
// 【重要な制約】translate() は同期の純粋関数のまま維持する。en辞書が未ロードの状態で
// lang を "en" にすると、全キーが ja フォールバック＋大量の console.warn になってしまう。
// この制約を守るため、"lang を en に切り替えるのは loadEnDict() が解決した後" にする責任は
// 呼び出し側（stores/langStore.ts）が負う。ここでは「未ロード時は空辞書として扱う」という
// 安全側のフォールバックのみ用意する。

import { commonJa } from "../i18n/common.ja";
import { authJa } from "../i18n/auth.ja";
import { layoutJa } from "../i18n/layout.ja";

export type Lang = "ja" | "en";

// ja辞書はモジュールごとに分割し、ここで束ねる（高凝集・モジュール化）。
// 新しいモジュールの辞書を追加するときはここに1行足すだけでよい。
const DICT_JA: Record<string, string> = { ...commonJa, ...authJa, ...layoutJa };

// en辞書はメモリ内にのみ保持する（localStorageに辞書データ本体を保存しない。
// ブラウザのHTTPキャッシュに任せることで5MB制限・失効管理を自前で抱え込まない）。
// 一度ロードしたら以後は再ロードしない。
let dictEn: Record<string, string> | null = null;
let loadEnPromise: Promise<Record<string, string>> | null = null;

/**
 * 【設計意図】
 * en辞書（common/auth/layout の3モジュール）を動的importでまとめて読み込む。
 * 一度成功したら dictEn にメモリ保持し、以後は同じ Promise / 値を返す（再ロードしない）。
 * 失敗時は loadEnPromise をリセットして次回呼び出しでリトライ可能にする
 * （ネットワーク瞬断等からの復帰を許すため）。
 */
export function loadEnDict(): Promise<Record<string, string>> {
  if (dictEn) return Promise.resolve(dictEn);
  if (loadEnPromise) return loadEnPromise;

  loadEnPromise = Promise.all([
    import("../i18n/common.en"),
    import("../i18n/auth.en"),
    import("../i18n/layout.en"),
  ]).then(([common, auth, layout]) => {
    dictEn = { ...common.commonEn, ...auth.authEn, ...layout.layoutEn };
    return dictEn;
  }).catch((err) => {
    loadEnPromise = null;
    throw err;
  });

  return loadEnPromise;
}

/** テスト・内部用：現在メモリに保持しているen辞書の有無 */
export function isEnDictLoaded(): boolean {
  return dictEn !== null;
}

function getDict(lang: Lang): Record<string, string> {
  if (lang === "ja") return DICT_JA;
  // 呼び出し側の契約上、lang="en"はloadEnDict()解決後にしか来ない想定だが、
  // 万一未ロードのまま呼ばれても画面を壊さないよう空辞書＝jaフォールバックに倒す。
  return dictEn ?? {};
}

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
  const value = getDict(lang)[key];
  if (value !== undefined) return interpolate(value, vars);

  const fallback = DICT_JA[key];
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
