// src/lib/ai/inferConsultationType.ts
//
// 【設計意図】
// 入力テキストのキーワード解析から ConsultationType を自動判定する純粋関数。
// UIに依存しないため、テストが容易。
// 判定優先度: deadline_check > scope_change > simulate > diagnose > change（デフォルト）

import type { ConsultationType } from "../localData/types";

interface Rule {
  type: ConsultationType;
  keywords: RegExp;
}

const RULES: Rule[] = [
  {
    type: "deadline_check",
    // 締め切り日・逆算・間に合う などのキーワード
    keywords: /締め切り|締切|期限|逆算|間に合[いうえおわ]|までに完了|までに終|デッドライン|due/i,
  },
  {
    type: "scope_change",
    // 停止・縮小・やめる・外す などのキーワード
    keywords: /停止|中止|止め[るた]|やめ[るた]|辞め[るた]|縮小|スコープ(を|を縮|削減)|優先度.{0,6}(下|低)|外す|削除|取りやめ/i,
  },
  {
    type: "simulate",
    // もし〜たら・仮に・シミュレーション などのキーワード
    keywords: /もし|もしも|仮に|仮定|シミュレーション|what.?if|たとしたら|たとすると|延ばし?たら|増やし?たら|減らし?たら|変えたら/i,
  },
  {
    type: "diagnose",
    // 現状・診断・リスク・課題・洗い出し などのキーワード
    keywords: /現状|診断|リスク|課題|問題点|洗い出し|どんな状態|どういう状態|大丈夫|遅延|滞って|滞り|把握|確認し?たい|チェック/i,
  },
];

/**
 * テキストから ConsultationType を自動推定する。
 * マッチしない場合はデフォルト "change" を返す。
 */
export function inferConsultationType(text: string): ConsultationType {
  const trimmed = text.trim();
  if (!trimmed) return "change";

  for (const rule of RULES) {
    if (rule.keywords.test(trimmed)) return rule.type;
  }

  return "change";
}
