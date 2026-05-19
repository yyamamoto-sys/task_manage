// src/components/tour/tours/index.ts
//
// ツアー登録の唯一の入り口。新しいツアーを追加するときは
// ここに import + ALL_TOURS に登録するだけで TourProvider に行き渡る。

import type { Tour } from "./types";
import { firstTimeTour } from "./first-time";
import { aiIntroTour } from "./ai-intro";

export const ALL_TOURS: Record<string, Tour> = {
  [firstTimeTour.id]: firstTimeTour,
  [aiIntroTour.id]: aiIntroTour,
  // Phase 3 で追加予定：
  // [okrCycleTour.id]: okrCycleTour,
};

/** ガイドのツアー一覧に表示する順序（重要度の高い順） */
export const TOUR_LIST: Tour[] = [
  firstTimeTour,
  aiIntroTour,
];

export const FIRST_TIME_TOUR_ID = firstTimeTour.id;
