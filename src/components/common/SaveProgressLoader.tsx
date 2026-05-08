// src/components/common/SaveProgressLoader.tsx
//
// 【設計意図】
// AI 呼び出し（AIProgressLoader）と同じビジュアル言語で、DB 保存の進度を可視化する。
// 違いは「実進度ベース」であること——caller が現在ステップ数 / 総ステップ数を渡し、
// それに応じてプログレスバーと「X/Y ステップ」表示を更新する。
//
// 1ステップだけの保存は単純な spinner で十分なので、複数ステップを伴う保存
// （例：KRセッション保存 = セッション本体 + N件の宣言）でのみ使う。

import { useEffect, useState } from "react";

interface Props {
  /** 現在のステップ番号（1-indexed・0 なら開始前） */
  current: number;
  /** 総ステップ数（最低 1） */
  total: number;
  /** 現在のステップの説明文 */
  label?: string;
  /** ヘッダーに表示するタイトル */
  title?: string;
}

export function SaveProgressLoader({ current, total, label, title }: Props) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.max(0, Math.min(current, safeTotal));
  const pct = Math.round((safeCurrent / safeTotal) * 100);

  // ステップ間の体感を滑らかにする「微小サブ進捗」
  // current が変わってから次の current 更新までの間、わずかに前進し続ける
  const [subProgress, setSubProgress] = useState(0);
  useEffect(() => {
    setSubProgress(0);
    const start = Date.now();
    const id = setInterval(() => {
      const t = Math.min((Date.now() - start) / 1500, 1);
      setSubProgress(0.5 * (1 - Math.pow(1 - t, 2))); // 最大0.5ステップぶん前進
    }, 40);
    return () => clearInterval(id);
  }, [safeCurrent]);

  const displayPct = Math.min(
    99,
    Math.round(((safeCurrent + subProgress) / safeTotal) * 100),
  );

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: "22px",
        padding: "32px 20px", flex: 1,
      }}
    >
      {/* アイコン */}
      <div style={{
        position: "relative",
        width: "56px", height: "56px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {/* 外側リング（青系で AI 紫と差別化） */}
        <svg width="56" height="56" style={{ position: "absolute", inset: 0, animation: "spin 2.4s linear infinite" }}>
          <circle cx="28" cy="28" r="24"
            fill="none"
            stroke="url(#saveRingGrad)"
            strokeWidth="2.5"
            strokeDasharray="120 30"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="saveRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0ea5e9" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.5" />
            </linearGradient>
          </defs>
        </svg>
        <span style={{ fontSize: "22px", lineHeight: 1 }}>💾</span>
      </div>

      {/* タイトル + ラベル */}
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontSize: "13px", fontWeight: "600",
          color: "var(--color-text-primary)",
          marginBottom: "4px",
        }}>
          {title ?? "データベースに保存しています"}
        </div>
        <div key={`${safeCurrent}-${label ?? ""}`} className="animate-fadeIn" style={{
          fontSize: "11px", color: "var(--color-text-tertiary)",
          minHeight: "1.2em",
        }}>
          {label ?? "しばらくお待ちください…"}
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
            width: `${displayPct}%`,
            background: "linear-gradient(90deg, #0ea5e9 0%, #22c55e 100%)",
            borderRadius: "3px",
            transition: "width 0.15s ease-out",
          }} />
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: "10px", color: "var(--color-text-tertiary)",
        }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>
            ステップ {safeCurrent} / {safeTotal}
          </span>
          <span style={{ fontWeight: "600", color: "#0ea5e9", flexShrink: 0, marginLeft: "8px" }}>
            {pct}%
          </span>
        </div>
      </div>

      {/* ステップドット（最大 8 件まで表示・それ以上は省略） */}
      {safeTotal <= 8 && (
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {Array.from({ length: safeTotal }).map((_, i) => (
            <div key={i} style={{
              height: "6px",
              width: i === safeCurrent - 1 ? "18px" : "6px",
              borderRadius: "3px",
              background: i < safeCurrent - 1
                ? "#0ea5e9"
                : i === safeCurrent - 1
                  ? "linear-gradient(90deg, #0ea5e9, #22c55e)"
                  : "var(--color-bg-tertiary)",
              transition: "all 0.3s ease",
              flexShrink: 0,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
