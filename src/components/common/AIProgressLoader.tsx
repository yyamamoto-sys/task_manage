// src/components/common/AIProgressLoader.tsx
// AI処理中の進捗アニメーションコンポーネント。
// フェーズ文字列の配列を受け取り、時間ベースで自動的に進捗を演出する。

import { useState, useEffect } from "react";

interface Props {
  phases: string[];
  intervalMs?: number; // フェーズごとの表示時間（ms）
}

export function AIProgressLoader({ phases, intervalMs = 4000 }: Props) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [subProgress, setSubProgress] = useState(0);

  // フェーズを時間で進める
  useEffect(() => {
    if (phaseIndex >= phases.length - 1) return;
    const t = setTimeout(() => setPhaseIndex(p => p + 1), intervalMs);
    return () => clearTimeout(t);
  }, [phaseIndex, phases.length, intervalMs]);

  // フェーズ内のサブ進捗（イーズアウトで88%まで滑らかに上昇）
  useEffect(() => {
    setSubProgress(0);
    const start = Date.now();
    const duration = intervalMs * 0.88;
    const id = setInterval(() => {
      const t = Math.min((Date.now() - start) / duration, 1);
      setSubProgress(0.88 * (1 - Math.pow(1 - t, 2)));
    }, 40);
    return () => clearInterval(id);
  }, [phaseIndex, intervalMs]);

  const totalPct = Math.min(
    99,
    Math.round(((phaseIndex + subProgress) / phases.length) * 100),
  );

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
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.3" />
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
          AIが処理中です。しばらくお待ちください…
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
            width: `${totalPct}%`,
            background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)",
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
          <span style={{ fontWeight: "600", color: "#6366f1", flexShrink: 0, marginLeft: "8px" }}>
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
              ? "#6366f1"
              : i === phaseIndex
                ? "linear-gradient(90deg, #6366f1, #8b5cf6)"
                : "var(--color-bg-tertiary)",
            transition: "all 0.3s ease",
            flexShrink: 0,
          }} />
        ))}
      </div>
    </div>
  );
}
