// src/lib/personalOkr/importMatch.ts
//
// 【設計意図】
// Kintone取込で抽出したKRを「既存のpersonal_kr／グループKR・TF」に対応づけるための
// 候補提示（ランキング）だけを行う純粋関数群。🔴最終決定は必ず人（確認画面のドロップダウン）
// ——ここでの結果は初期選択のヒントにすぎず、自動確定はしない
// （docs/dev/okr-redesign-plan.md §8 Phase2・CLAUDE.md Section 24参照）。
//
// 【既存personal_krへの対応づけが最重要な理由】
// 既存の同じ四半期のpersonal_krを取込で作り直すと、personal_kr_weeks/personal_kr_memosは
// personal_kr_id（＝行のid）にしか紐づいていないため、新しいidのKRを作ると古いidに
// ぶら下がっていた週の目標状態・メモが画面から孤立して見えなくなる。この関数群は
// 「既存のどの行と同一のKRか」をラベル・種別の一致度でランキングするだけで、
// 実際の書き込み（buildImportApplyPlan.ts）はidを正しく引き継ぐ側の責務。

import type { KeyResult, PersonalKr, PersonalKrKind, TaskForce } from "../localData/types";

// 全角スペースは正規表現リテラル中に直接書くとeslint no-irregular-whitespaceに引っかかる
// （src/lib/htmlText.tsの既存パターンと同じ制約）。文字列定数として保持し、
// normalize()側でRegExpを動的生成することで回避する。
const FULLWIDTH_SPACE = "　";
const NORMALIZE_STRIP_RE_BASE = "[\\s()（）｜|/／・：:,、。.]";

function normalize(s: string): string {
  const stripAll = new RegExp(`[${FULLWIDTH_SPACE}]|${NORMALIZE_STRIP_RE_BASE}`, "g");
  return s.replace(stripAll, "").toLowerCase();
}

/** 2文字列の簡易的な文字重なり率（0〜1）。形態素解析等は行わない軽量版 */
function charOverlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length === 0) return 0;
  let hit = 0;
  for (const ch of shorter) if (longer.includes(ch)) hit++;
  return hit / shorter.length;
}

export interface PersonalKrMatchCandidate {
  personalKr: PersonalKr;
  score: number; // 0〜1。高いほど有力
}

/**
 * 抽出したKR（label・kr_kind）を、同じ四半期の既存personal_kr群にランキングして対応づける。
 * 完全一致・部分一致・種別一致を加点方式で評価する簡易スコアリング（matchMemberByNameより
 * 緩い基準にしている理由＝Kintoneのタイトル文言とアプリ内labelは表記が揺れやすいため、
 * ここでは「曖昧なら候補から外す」のではなく「順位付けして人に見せる」を選んだ）。
 */
export function rankExistingPersonalKrMatches(
  extractedLabel: string,
  extractedKrKind: PersonalKrKind,
  existingKrs: PersonalKr[],
): PersonalKrMatchCandidate[] {
  const target = normalize(extractedLabel);
  const scored = existingKrs.map(personalKr => {
    const label = normalize(personalKr.label);
    let score = 0;
    if (extractedKrKind === personalKr.kr_kind) score += 0.25;
    if (target && label) {
      if (label === target) score += 0.75;
      else if (label.includes(target) || target.includes(label)) score += 0.5;
      else score += charOverlapRatio(target, label) * 0.35;
    }
    return { personalKr, score: Math.min(1, score) };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** 最有力候補のスコアがこの値未満なら「新規作成」を既定選択にする（曖昧な自動選択を避ける） */
export const AUTO_SELECT_THRESHOLD = 0.5;

/** ランキング結果から、確認画面の初期選択（既存対応 or 新規作成）を決める */
export function pickDefaultMapping(candidates: PersonalKrMatchCandidate[]): string | null {
  const top = candidates[0];
  if (!top || top.score < AUTO_SELECT_THRESHOLD) return null; // null = 新規作成
  return top.personalKr.id;
}

// ===== グループKR・TFの候補提示（kr_kind==='group_kr'のときのみ使う） =====

export interface GroupTfMatchCandidate {
  taskForce: TaskForce;
  keyResult: KeyResult;
  score: number;
}

/**
 * 「KR1-TF2 AAS」のような原文ヒントから、表示中の部署に絞られたTF群を採点する。
 * 🔴候補提示のみ・自動確定しない（呼び出し元は必ずドロップダウンで人に選ばせる）。
 * KR番号（"KR1"）はアプリのKeyResultに対応する列を持たないため数値マッチングはできない
 * （CLAUDE.md Section 24参照）。TF名・KRタイトルとヒント文字列の重なりだけで採点する。
 */
export function rankGroupTfMatches(
  hintText: string | null | undefined,
  tfsInGroup: TaskForce[],
  krsInGroup: KeyResult[],
): GroupTfMatchCandidate[] {
  const target = normalize(hintText ?? "");
  if (!target) return [];
  const krById = new Map(krsInGroup.map(k => [k.id, k]));
  const scored: GroupTfMatchCandidate[] = [];
  for (const tf of tfsInGroup) {
    const kr = krById.get(tf.kr_id);
    if (!kr) continue;
    const tfName = normalize(tf.name);
    const krTitle = normalize(kr.title);
    let score = 0;
    if (tfName && (target.includes(tfName) || tfName.includes(target))) score += 0.6;
    else if (tfName) score += charOverlapRatio(target, tfName) * 0.3;
    if (krTitle && (target.includes(krTitle) || krTitle.includes(target))) score += 0.3;
    if (score > 0) scored.push({ taskForce: tf, keyResult: kr, score: Math.min(1, score) });
  }
  return scored.sort((a, b) => b.score - a.score);
}
