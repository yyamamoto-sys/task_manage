// src/components/common/AIProgressLoader.tsx
// AI処理中の進捗アニメーションコンポーネント。
//
// 【設計意図】AI呼び出しはストリーミングしておらず、本当の進捗（トークン生成の
// 途中経過）は取得できない。そのため経過時間から進捗を演出するが、以下の2点を守る：
// ① バーは95%を超えない漸近曲線で最後まで動き続ける（途中で頭打ちにしない）。
// ② 経過秒数は実時間に比例して単調に増え続けるため、パーセント表示の増分が
//    極めて小さくなる長時間の遅延でも「止まっている」ようには見せない
//    （％とフェーズ文言は止まって見えることがあっても、秒数だけは必ず動く）。
// 計算ロジックは src/lib/progress/progressCurve.ts に切り出し純粋関数としてテストする。

import { useEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import {
  computeAsymptoticPct,
  resolvePhaseIndex,
  computeElapsedSeconds,
  isTakingLongerThanUsual,
  resolveExpectedRangeSeconds,
} from "../../lib/progress/progressCurve";

interface Props {
  phases: string[];
  /** 目安の中央値（ms）。フェーズの進み方・漸近曲線・経過秒数の目安表示のすべての基準になる。 */
  expectedMs: number;
  /** 目安の範囲（ms）。省略時は expectedMs から自動算出する（progressCurve.ts参照）。 */
  expectedRangeMs?: readonly [number, number];
}

const TICK_MS = 200;

export function AIProgressLoader({ phases, expectedMs, expectedRangeMs }: Props) {
  const t = useT();
  const startRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  // expectedMsやphasesが変わる（＝新しい処理が始まる）たびに経過時間をリセットする。
  useEffect(() => {
    startRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startRef.current);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [expectedMs, phases.length]);

  const pct = computeAsymptoticPct(elapsedMs, expectedMs);
  const phaseIndex = resolvePhaseIndex(elapsedMs, expectedMs, phases.length);
  const elapsedSec = computeElapsedSeconds(elapsedMs);
  const [minSec, maxSec] = resolveExpectedRangeSeconds(expectedMs, expectedRangeMs);
  const isDelayed = isTakingLongerThanUsual(elapsedMs, maxSec * 1000);
  const totalPct = Math.round(pct);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: "22px",
      padding: "32px 20px", flex: 1,
    }}>

      {/* アイコン */}
      <div style={{
        position: "relative",
        width: "56px", height: "56px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {/* 外側リング */}
        <svg width="56" height="56" style={{ position: "absolute", inset: 0, animation: "spin 2.4s linear infinite" }}>
          <circle cx="28" cy="28" r="24"
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="2.5"
            strokeDasharray="120 30"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--color-ai-from)" />
              <stop offset="100%" stopColor="var(--color-ai-to)" stopOpacity="0.3" />
            </linearGradient>
          </defs>
        </svg>
        <span style={{ fontSize: "22px", lineHeight: 1 }}>✨</span>
      </div>

      {/* フェーズテキスト */}
      <div style={{ textAlign: "center" }}>
        <div key={phaseIndex} className="animate-fadeIn" style={{
          fontSize: "13px", fontWeight: "600",
          color: "var(--color-text-primary)",
          marginBottom: "4px",
        }}>
          {phases[phaseIndex]}
        </div>
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          {isDelayed ? t("common.aiProgress.delayed") : t("common.aiProgress.waiting")}
        </div>
        <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
          {t("common.aiProgress.elapsed", { sec: elapsedSec, min: minSec, max: maxSec })}
        </div>
      </div>

      {/* プログレスバー */}
      <div style={{ width: "100%", maxWidth: "260px" }}>
        <div style={{
          height: "5px",
          background: "var(--color-bg-tertiary)",
          borderRadius: "3px",
          overflow: "hidden",
          marginBottom: "8px",
        }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--color-ai-from) 0%, var(--color-ai-to) 100%)",
            borderRadius: "3px",
            transition: "width 0.15s ease-out",
          }} />
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: "10px", color: "var(--color-text-tertiary)",
        }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>
            {phases[phaseIndex]}
          </span>
          <span style={{ fontWeight: "600", color: "var(--color-ai-from)", flexShrink: 0, marginLeft: "8px" }}>
            {totalPct}%
          </span>
        </div>
      </div>

      {/* フェーズドット */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {phases.map((_, i) => (
          <div key={i} style={{
            height: "6px",
            width: i === phaseIndex ? "18px" : "6px",
            borderRadius: "3px",
            background: i < phaseIndex
              ? "var(--color-ai-from)"
              : i === phaseIndex
                ? "linear-gradient(90deg, var(--color-ai-from), var(--color-ai-to))"
                : "var(--color-bg-tertiary)",
            transition: "all 0.3s ease",
            flexShrink: 0,
          }} />
        ))}
      </div>
    </div>
  );
}
