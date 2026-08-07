// src/lib/personalOkr/bandOptions.ts
//
// 【設計意図】
// 達成度バンド（60/70/80/90/100）の選択肢と、90・100が常に選べない理由を1箇所に集約する。
// docs/dev/okr-redesign-plan.md §1-3：「3Qは基本的に90・100を置かない」運用。Phase 1は
// AI判定（band_ai）もAI併用の上書き分離（band_override）も未実装のため、ここでは
// personal_kr_months.band_target（Kintoneに書いた当月の狙い）の手入力用の選択肢として使う。

import type { PersonalKrBand } from "../localData/types";

export const BAND_VALUES: PersonalKrBand[] = [60, 70, 80, 90, 100];

export const BAND_LABELS: Record<PersonalKrBand, string> = {
  60: "この取り組みがなくても到達していた水準",
  70: "介入による明確な改善・前進",
  80: "第三者にも成果が明らか",
  90: "誰が見ても成功が明らかで革新的要素を含む",
  100: "既存の発想・やり方では達成できない＝要革新",
};

/** 90・100は常に選択不可（取り消し線＋非活性）。3Qは基本的に置かない運用のため */
export function isBandDisabled(band: PersonalKrBand): boolean {
  return band >= 90;
}
