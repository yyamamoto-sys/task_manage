// src/lib/personalOkr/krMonthScope.ts
//
// 【設計意図】
// 個人KRの「対象月」（active_month_indexes）と「月ごとの実効ウェイト」
// （weight_override_pct）を解決する唯一の計算元。CLAUDE.md Section 24・仕様書§W3参照。
// KRタブ一覧・タブのウェイト表示・「全体」タブの参考値・KR編集モーダルの月ごとの合計表示、
// いずれもここを経由すること（同じ計算を各所で書き直さない）。
//
// 【🔴 未適用時でも壊れない設計（仕様書§W2・トラップ2）】
// active_month_indexes は 2026-08-26 のマイグレーション（20260826b_...sql）で追加した列。
// マイグレーション未適用の間は fetchPersonalKrs() が返す行にこのキー自体が存在しない
// （PostgRESTのselect("*")は実在する列だけを返すため、SELECT側はエラーにならない）。
// isKrActiveInMonth はこの undefined を「[1,2,3]（全月対象）」として扱う。
// これにより未適用の環境でも読み取り側は従来どおりの挙動（全月対象）を維持する。
//
// 【🔴 `??` は0を落とさないが `||` は落とす（トラップ3）】
// weight_override_pct が 0（＝この月のウェイトを意図的に0%にした）のとき、
// `monthRecord?.weight_override_pct || kr.weight_pct` は 0 をfalsyとして誤って
// 四半期共通値へフォールバックしてしまう。必ず `??` を使うこと。

import type { PersonalKrMonth } from "../localData/types";

// 🔴 PersonalKr.active_month_indexesは`(1|2|3)[]`だが、DBから返る実データ・テストの合成データは
// 単なるnumber[]として扱われることが多いため、ここでは緩めた型（number[]）で受ける
// （呼び出し側にキャストや型アサーションを強制しない）。
interface KrActiveMonthFields { active_month_indexes?: number[] }
interface KrWeightFields extends KrActiveMonthFields { weight_pct: number }
type MonthWeightFields = Pick<PersonalKrMonth, "weight_override_pct">;

/** そのKRが指定の月（1〜3）を対象にしているか。未適用（undefined）は全月対象として扱う。 */
export function isKrActiveInMonth(kr: KrActiveMonthFields, monthIndex: 1 | 2 | 3): boolean {
  return (kr.active_month_indexes ?? [1, 2, 3]).includes(monthIndex);
}

/**
 * その月のこのKRの実効ウェイト（%）を返す。
 * - 対象外の月なら null
 * - 対象の月なら、その月の weight_override_pct（上書きがあれば）を優先し、
 *   無ければ（undefined/null）四半期共通の weight_pct を使う。
 *   🔴 weight_override_pct が 0 のときは 0 をそのまま返す（フォールバックしない）。
 */
export function resolveEffectiveWeightPct(
  kr: KrWeightFields,
  monthRecord: MonthWeightFields | null | undefined,
  monthIndex: 1 | 2 | 3,
): number | null {
  if (!isKrActiveInMonth(kr, monthIndex)) return null;
  return monthRecord?.weight_override_pct ?? kr.weight_pct;
}

/**
 * その月の対象KRだけを対象に、実効ウェイトの合計を返す（対象外のKRは合計に含めない）。
 * monthRecordsByKrId は krId → その月の PersonalKrMonth（無ければ undefined/null）。
 */
export function sumEffectiveWeightPct(
  krs: (KrWeightFields & { id: string })[],
  monthRecordsByKrId: Record<string, MonthWeightFields | null | undefined>,
  monthIndex: 1 | 2 | 3,
): number {
  return krs.reduce((sum, kr) => {
    const effective = resolveEffectiveWeightPct(kr, monthRecordsByKrId[kr.id], monthIndex);
    return effective == null ? sum : sum + effective;
  }, 0);
}

/**
 * krs 全件について、monthsByKr[kr.id] が読み込み済み（undefinedでない）かどうか。
 * v3.106・仕様書のバグ修正：ウェイト合計の警告表示（PersonalOkrView.tsx）と
 * 「全体」タブの読み込み中判定（PersonalOverallView.tsx）が同じ条件を別々に書いていたため
 * ここへ一元化した（同じ判定ロジックを各所で書き直さない）。krsが0件なら「揃っている」扱い
 * （空集合はvacuously true）。
 */
export function areAllKrMonthsLoaded(
  krs: { id: string }[],
  monthsByKr: Record<string, unknown[] | undefined>,
): boolean {
  return krs.every(kr => monthsByKr[kr.id] !== undefined);
}
