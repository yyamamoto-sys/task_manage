// src/components/tour/tours/index.ts
//
// ツアー登録の唯一の入り口。新しいツアーを追加するときは
// ここに import + ALL_TOURS に登録するだけで TourProvider に行き渡る。

import type { Tour } from "./types";
import { firstTimeTour } from "./first-time";

export const ALL_TOURS: Record<string, Tour> = {
  [firstTimeTour.id]: firstTimeTour,
  // Phase 2 で追加予定：
  // [aiIntroTour.id]: aiIntroTour,
  // [okrCycleTour.id]: okrCycleTour,
};

export const FIRST_TIME_TOUR_ID = firstTimeTour.id;
