// src/components/lab/widgets/DueForecastWidget.tsx
//
// 【設計意図】
// 締切の見通し（棒グラフ）。既存の DueForecastChart（src/components/dashboard/
// DueForecastChart.tsx。内部で computeDueForecast を呼ぶ）をそのまま埋め込むだけ。
// 新しい集計ロジック・新しい描画は一切作らない（真実の源・表現の二重化を避ける）。

import type { WidgetContext } from "../../../lib/widgets/types";
import { DueForecastChart } from "../../dashboard/DueForecastChart";

export function DueForecastWidget({ data }: WidgetContext) {
  return <DueForecastChart tasks={[...data.tasks]} />;
}
