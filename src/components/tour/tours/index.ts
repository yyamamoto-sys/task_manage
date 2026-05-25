// src/components/tour/tours/index.ts
//
// ツアー登録の唯一の入り口。新しいツアーを追加するときは
// ここに import + ALL_TOURS に登録するだけで TourProvider に行き渡る。
//
// 2026-05：主要画面ツアーと AI機能ツアーを first-time の1本に統合した。

import type { Tour } from "./types";
import { firstTimeTour } from "./first-time";

export const ALL_TOURS: Record<string, Tour> = {
  [firstTimeTour.id]: firstTimeTour,
};

/** ガイドのツアー一覧に表示する順序（重要度の高い順） */
export const TOUR_LIST: Tour[] = [
  firstTimeTour,
];

export const FIRST_TIME_TOUR_ID = firstTimeTour.id;
