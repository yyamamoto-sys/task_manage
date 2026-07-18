// src/components/dashboard/VelocityChart.tsx
//
// 【設計意図】
// 「完了ペース」折れ線グラフ（インラインSVG・外部ライブラリ不使用）。
// 単一系列（完了タスク数の推移）なので success 色1色で統一：面フィル（低不透明度）＋
// 2px の線。最終点（今週）は大きめの丸＋件数ラベルで強調する（まだ週の途中＝暫定値
// であることが分かるよう「今週」ラベルを添える）。薄い水平グリッド＋Y目盛を敷き、
// x軸に週ラベル（各週の月曜日）を表示する。
// 集計自体は純粋関数 computeWeeklyVelocity（src/lib/computeWeeklyVelocity.ts）に切り出し
// 単体テスト済み。このコンポーネントは描画のみを担う。

import { useMemo } from "react";
import type { Task } from "../../lib/localData/types";
import { todayStr } from "../../lib/date";
import { computeWeeklyVelocity } from "../../lib/computeWeeklyVelocity";

const CHART_W = 320;
const CHART_H = 84;
const LEFT_PAD = 24;
const RIGHT_PAD = 12;
const TOP_PAD = 14;
const BOTTOM_PAD = 26;
const SVG_W = LEFT_PAD + CHART_W + RIGHT_PAD;
const SVG_H = TOP_PAD + CHART_H + BOTTOM_PAD;
const GRID_LINES = 3;

export function VelocityChart({ tasks }: { tasks: Task[] }) {
  const today = todayStr();
  const buckets = useMemo(() => computeWeeklyVelocity(tasks, today), [tasks, today]);

  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const stepX = buckets.length > 1 ? CHART_W / (buckets.length - 1) : 0;
  const yFor = (count: number) => TOP_PAD + CHART_H - (count / maxCount) * CHART_H;
  const xFor = (i: number) => LEFT_PAD + i * stepX;

  const points = buckets.map((b, i) => ({ x: xFor(i), y: yFor(b.count), b }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${TOP_PAD + CHART_H} L ${points[0].x} ${TOP_PAD + CHART_H} Z`
    : "";

  const lastPoint = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="直近8週間の完了ペース（週ごとの完了タスク数）"
    >
      {/* 水平グリッド＋Y目盛 */}
      {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
        const frac = i / GRID_LINES;
        const y = TOP_PAD + CHART_H * (1 - frac);
        const value = Math.round(maxCount * frac);
        return (
          <g key={i}>
            <line x1={LEFT_PAD} y1={y} x2={LEFT_PAD + CHART_W} y2={y} stroke="var(--color-border-primary)" strokeWidth={1} opacity={0.6} />
            <text x={LEFT_PAD - 6} y={y + 3} textAnchor="end" fontSize={8} fill="var(--color-text-tertiary)">{value}</text>
          </g>
        );
      })}

      {areaPath && <path d={areaPath} fill="var(--color-text-success)" fillOpacity={0.14} stroke="none" />}
      {linePath && <path d={linePath} fill="none" stroke="var(--color-text-success)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

      {points.map((p, i) => {
        const isLast = i === points.length - 1;
        return (
          <g key={p.b.weekStart}>
            <title>{`週：${p.b.count}件完了`}</title>
            <circle cx={p.x} cy={p.y} r={isLast ? 4 : 2.5} fill="var(--color-text-success)" />
            {/* x軸：週ラベル */}
            <text
              x={p.x}
              y={TOP_PAD + CHART_H + 14}
              textAnchor="middle"
              fontSize={9}
              fill={isLast ? "var(--color-text-primary)" : "var(--color-text-tertiary)"}
              fontWeight={isLast ? 700 : 400}
            >
              {p.b.label}
            </text>
          </g>
        );
      })}

      {/* 最終点（今週）の件数ラベル強調 */}
      {lastPoint && (
        <text
          x={lastPoint.x}
          y={Math.max(lastPoint.y - 8, 10)}
          textAnchor="end"
          fontSize={11}
          fontWeight={700}
          fill="var(--color-text-success)"
        >
          {`今週 ${lastPoint.b.count}件`}
        </text>
      )}
    </svg>
  );
}
