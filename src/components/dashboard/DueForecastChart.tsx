// src/components/dashboard/DueForecastChart.tsx
//
// 【設計意図】
// 「締切の見通し」棒グラフ（インラインSVG・外部ライブラリ不使用）。
// マグニチュード（件数）表現なので単一色相（accent=--color-brand）でバーを描く。
// 超過だけ状態色（danger）で意味を分離し、土日は淡く（opacity低下）、今日は強調
// （ハイライト帯＋太字ラベル）、最多の日（山場）にはラベルを付ける。
// 集計自体は純粋関数 computeDueForecast（src/lib/computeDueForecast.ts）に切り出し
// 単体テスト済み。このコンポーネントは描画のみを担う。

import { useMemo } from "react";
import type { Task } from "../../lib/localData/types";
import { todayStr } from "../../lib/date";
import { computeDueForecast } from "../../lib/computeDueForecast";

const BAR_W = 20;
const GAP = 5;
const CHART_H = 84;
const TOP_PAD = 16;
const BOTTOM_PAD = 32;
const SVG_H = TOP_PAD + CHART_H + BOTTOM_PAD;

export function DueForecastChart({ tasks }: { tasks: Task[] }) {
  const today = todayStr();
  const buckets = useMemo(() => computeDueForecast(tasks, today), [tasks, today]);

  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const svgW = buckets.length * (BAR_W + GAP) + GAP;

  // 山場：超過を除く日別バケットのうち最多件の最初の1つ（全て0件なら山場なし）
  const peakDate = useMemo(() => {
    const daily = buckets.filter(b => b.kind !== "overdue");
    const max = Math.max(0, ...daily.map(b => b.count));
    if (max === 0) return null;
    return daily.find(b => b.count === max)?.date ?? null;
  }, [buckets]);

  return (
    <svg
      viewBox={`0 0 ${svgW} ${SVG_H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="今後2週間の締切見通し（日別の未完了タスク数）"
    >
      {/* 基線（0の位置。薄く表示して端点の基準にする） */}
      <line x1={0} y1={TOP_PAD + CHART_H} x2={svgW} y2={TOP_PAD + CHART_H} stroke="var(--color-border-primary)" strokeWidth={1} />

      {buckets.map((b, i) => {
        const x = GAP + i * (BAR_W + GAP);
        const barH = Math.round((b.count / maxCount) * (CHART_H - 6));
        const isOverdue = b.kind === "overdue";
        const isToday = b.kind === "today";
        const isWeekend = b.kind === "weekend";
        const isPeak = b.date !== null && b.date === peakDate;
        const fill = isOverdue ? "var(--color-text-danger)" : "var(--color-brand)";

        return (
          <g key={b.date ?? "overdue"} opacity={isWeekend ? 0.45 : 1}>
            <title>{`${isOverdue ? "超過" : b.label}：${b.count}件`}</title>

            {/* 今日の強調カラム（バー本体より広い薄い背景帯） */}
            {isToday && (
              <rect x={x - 3} y={TOP_PAD - 4} width={BAR_W + 6} height={CHART_H + 4} fill="var(--color-brand-light)" rx={3} />
            )}

            {/* バー本体（0件でも1pxの高さで存在を示す） */}
            <rect
              x={x}
              y={TOP_PAD + CHART_H - Math.max(barH, 1)}
              width={BAR_W}
              height={Math.max(barH, 1)}
              fill={fill}
              rx={2}
            />

            {/* 件数ラベル（バー上部） */}
            <text
              x={x + BAR_W / 2}
              y={Math.max(TOP_PAD + CHART_H - barH - 4, 10)}
              textAnchor="middle"
              fontSize={9}
              fill={isOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)"}
              fontWeight={isOverdue || isToday ? 700 : 400}
            >
              {b.count}
            </text>

            {/* 日付ラベル（バー下部） */}
            <text
              x={x + BAR_W / 2}
              y={TOP_PAD + CHART_H + 14}
              textAnchor="middle"
              fontSize={9}
              fill={isToday ? "var(--color-text-primary)" : "var(--color-text-tertiary)"}
              fontWeight={isToday ? 700 : 400}
            >
              {b.label}
            </text>

            {/* 山場ラベル */}
            {isPeak && (
              <text
                x={x + BAR_W / 2}
                y={TOP_PAD + CHART_H + 26}
                textAnchor="middle"
                fontSize={8}
                fill="var(--color-brand)"
                fontWeight={600}
              >
                ▲山場
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
