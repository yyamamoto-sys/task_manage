// src/components/lab/widgets/VelocityWidget.tsx
//
// 【設計意図】
// 完了ペース（折れ線グラフ）。既存の VelocityChart（src/components/dashboard/
// VelocityChart.tsx。内部で computeWeeklyVelocity を呼ぶ）をそのまま埋め込むだけ。
// 新しい集計ロジック・新しい描画は一切作らない（真実の源・表現の二重化を避ける）。

import type { WidgetContext } from "../../../lib/widgets/types";
import { VelocityChart } from "../../dashboard/VelocityChart";

export function VelocityWidget({ data }: WidgetContext) {
  return <VelocityChart tasks={[...data.tasks]} />;
}
