// src/lib/personalOkr/importFieldParse.ts
//
// 【設計意図】
// Kintone取込（personalOkrImportExtractor）が返す生の値を、personal_krs/personal_kr_months
// の列制約に合わせて正規化する純粋関数群。AIの出力を信用しきらず、enum・数値の妥当性は
// ここで機械的に確定させる（okrImportMatch.tsのmatchMemberByNameと同じ「AIに丸投げしない」
// 方針）。
//
// 【kr_kindの対応づけをAIにやらせない理由】
// kr_kindはCHECK制約のある固定enum（migrations/20260807b_add_personal_okr.sql）。
// AIには元のKintone表記（"グループKR1"等）をそのまま返させ、enumへの変換はこの関数で
// 決定的に行う（自由文からの分類をAIの出力に依存させない）。

import type { PersonalKrBand, PersonalKrKind } from "../localData/types";

const VALID_BANDS: readonly number[] = [60, 70, 80, 90, 100];

/**
 * KintoneのKR種別表記→personal_krs.kr_kind。
 * "グループKR1"〜"グループKR9"はすべて "group_kr"（実際の紐づけ先KR/TFは人が選ぶ。
 * 番号自体はgroup_kr_hintとして別途保持する）。
 * 不明・空欄・想定外の文字列は "general"（"全般"含む）にフォールバックする
 * （データを捨てるより「全般」として取り込み、人が編集できる状態にする）。
 */
export function mapKrKindHint(raw: string | null | undefined): PersonalKrKind {
  const s = (raw ?? "").trim();
  if (/グループKR/.test(s)) return "group_kr";
  if (s.includes("全社共通")) return "company_common";
  if (s.includes("OM共通")) return "om_common";
  if (s.includes("AGM共通")) return "agm_common";
  if (s.includes("リーダー共通")) return "leader_common";
  return "general";
}

/**
 * 達成度バンドの数値を60/70/80/90/100のいずれかに正規化する。
 * それ以外の数値・文字列・null/undefinedはnull（=未設定のまま。埋めない）。
 */
export function parseBandValue(raw: number | string | null | undefined): PersonalKrBand | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const stripped = raw.replace(/[^0-9.-]/g, "");
    if (!stripped) return null; // 数字を1文字も含まない文字列（"不明"等）
    const n = Number(stripped);
    return Number.isFinite(n) && VALID_BANDS.includes(n) ? (n as PersonalKrBand) : null;
  }
  return VALID_BANDS.includes(raw) ? (raw as PersonalKrBand) : null;
}

/**
 * ウェイト（%）の数値をパースする。"35 ％"のような単位付き文字列にも対応。
 * 負値・非数値・null/undefinedはnull。
 */
export function parseWeightPct(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const stripped = raw.replace(/[^0-9.-]/g, "");
    if (!stripped) return null; // 数字を1文字も含まない文字列（"不明"等）
    const n = Number(stripped);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/**
 * 自己評価・GM評価等の「%数値」パース。parseWeightPctと実装は同一（0以上の数値のみ許可）
 * だが、呼び出し側での意味の取り違えを避けるため別名を用意する。
 */
export const parsePercentValue = parseWeightPct;
