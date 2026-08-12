// src/components/tour/tours/index.ts
//
// ツアー登録の唯一の入り口。新しいツアーを追加するときは
// ここに import + ALL_TOURS に登録するだけで TourProvider に行き渡る。
// ⚠ 新規ツアー・ステップを作る前に必ず読む：docs/dev/tour-guidelines.md（統一基準）
//
// 2026-05：主要画面ツアーと AI機能ツアーを first-time の1本に統合した。

import type { Tour, TourStep } from "./types";
import { firstTimeTour } from "./first-time";
import { okrIntroTour } from "./okr-intro";

export const ALL_TOURS: Record<string, Tour> = {
  [firstTimeTour.id]: firstTimeTour,
  [okrIntroTour.id]: okrIntroTour,
};

/** ガイドのツアー一覧に表示する順序（重要度の高い順） */
export const TOUR_LIST: Tour[] = [
  firstTimeTour,
  okrIntroTour,
];

export const FIRST_TIME_TOUR_ID = firstTimeTour.id;
export const OKR_TOUR_ID = okrIntroTour.id;

/**
 * 【設計意図】ゲスト（サンプル閲覧）向けにツアー定義を差し替える純粋関数。
 * ゲストはSupabaseに一切接続しない設計（CLAUDE.md Section 23）のため、
 * AI実演ステップ（demo-ai-consult）をそのまま出すとサンプルAI利用の回数枠
 * （1日3回）をツアー閲覧だけで消費してしまう。ここでは実演を説明のみへ
 * 差し替え、ゲストでは存在しないUI（右下＋ボタン＝FAB）の説明ステップを除去する。
 *
 * `firstTimeTour`（モジュールレベル定数）は一切書き換えない。新しい配列・
 * 新しいオブジェクトを組み立てて返すことで、通常ユーザーの ALL_TOURS には
 * 影響しない。
 *
 * 🔴 okrIntroTour（OKRモードのガイドツアー）はゲスト向けの改変が不要
 * （FABの参照も実演アクションも持たない）。ゲスト分岐でも ALL_TOURS の一部だけを
 * 差し替えるのではなく必ず両方のツアーを返すこと（片方だけ返すとゲストのガイドから
 * OKRツアーが再生できなくなる）。
 */
export function buildTours(opts: { isGuest: boolean }): Record<string, Tour> {
  if (!opts.isGuest) return ALL_TOURS;

  const guestSteps: TourStep[] = firstTimeTour.steps
    .filter(step => step.id !== "fab")
    .map((step): TourStep => {
      if (step.id === "welcome") {
        return {
          ...step,
          // 【v3.71で更新】v3.69でゲストの編集を開放したのに合わせ、「架空データである」旨に加えて
          // 「編集して構わない・保存されない」ことも伝える（編集できるようになったことが
          // ツアーで伝わらないと、せっかくの開放が体験されない）。
          body: `${step.body}\n\n表示されているのは架空のサンプルデータです。自由に編集して構いません（内容は保存されず、再読み込みで元に戻ります）。`,
        };
      }
      if (step.id === "ai-consult-demo") {
        // action・target を持たせない＝実際にAI相談は送信しない（回数枠を消費させない）。
        // 中央表示にすることで skipIfMissing に頼らず必ず出す。
        return {
          id: "ai-consult-demo",
          placement: "center",
          title: "💬 AIには自分で相談してみましょう",
          body: "右側の AI パネルに相談を入力すると、登録済みのタスクを踏まえた分析やアドバイスが返ってきます。\n\nサンプルでの AI 利用は 1 日 3 回までです。せっかくなので、ご自身が気になることを相談してみてください。",
        };
      }
      return step;
    });

  const guestFirstTimeTour: Tour = { ...firstTimeTour, steps: guestSteps };

  return { [guestFirstTimeTour.id]: guestFirstTimeTour, [okrIntroTour.id]: okrIntroTour };
}
