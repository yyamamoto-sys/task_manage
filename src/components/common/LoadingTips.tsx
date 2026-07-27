// src/components/common/LoadingTips.tsx
//
// 【設計意図】
// 初回データ読み込み中の待ち時間に、操作テクニックのヒントを1つずつ出すカード。
// 内容は「初回ガイドツアー（tour/tours/first-time.ts）では扱っていないテクニック」に限定する
// （ツアーと同じ話を繰り返しても待ち時間の価値にならないため）。
//
// 表示元データの優先順位は src/lib/tips/loadingTips.ts に集約：
//   前回起動時にキャッシュした DB の内容 → 無ければ組み込みの既定値
// （このコンポーネント自身は DB を読まない。読んでいる最中に表示される画面のため）
//
// index は state で持たず、モジュールレベルのセッション開始時刻からの経過時間で
// 毎レンダー算出する（src/lib/tips/loadingTips.ts の computeTipIndex/getTipRotationSession）。
// App.tsx の起動シーケンスはローディング画面が複数回アンマウント／再マウントされるため、
// state だと画面が切り替わるたびにヒントが最初から流れ直してしまう
// （どのヒントも短すぎて読み切れないという指摘への対応、2026-07-27）。
//
// アニメーションは globals.css の animate-fadeIn を流用する（prefers-reduced-motion の
// ガード対象に既に入っているため、個別に動きを止める実装を足さなくてよい）。

import { useEffect, useState } from "react";
import { computeTipIndex, getSessionTips, getTipRotationSession, ROTATE_INTERVAL_MS } from "../../lib/tips/loadingTips";

/** 再レンダーのためだけのtick間隔。indexそのものはcomputeTipIndexが経過時間から都度算出する */
const TICK_MS = 1000;

export function LoadingTips() {
  const tips = getSessionTips();
  const session = getTipRotationSession();
  // このstateは再レンダーのトリガーとしてのみ使う（値そのものは使わない）
  const [, tick] = useState(0);

  useEffect(() => {
    if (tips.length <= 1) return;
    const timer = setInterval(() => tick(t => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [tips.length]);

  if (tips.length === 0) return null;
  const index = computeTipIndex(Date.now() - session.startedAt, tips.length, session.offset, ROTATE_INTERVAL_MS);
  const tip = tips[index];

  return (
    <div
      style={{
        width: "min(420px, calc(100vw - 48px))",
        // 高さを固定して、ヒント切替のたびに上のスピナー・プログレスバーが
        // 動かないようにする（本文の行数はヒントごとに違うため）
        minHeight: "116px",
        display: "flex", flexDirection: "column", justifyContent: "center",
        gap: "6px",
        padding: "14px 16px",
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--radius-md)",
        textAlign: "left",
      }}
    >
      <div style={{
        fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
        color: "var(--color-text-tertiary)",
      }}>
        💡 知っていると便利
      </div>
      {/* key を変えて切り替えのたびに fadeIn を再生させる */}
      <div key={index} className="animate-fadeIn">
        {tip.title && (
          <div style={{
            fontSize: "13px", fontWeight: 600, marginBottom: "4px",
            color: "var(--color-text-primary)",
          }}>
            {tip.title}
          </div>
        )}
        <div style={{
          fontSize: "11.5px", lineHeight: 1.7,
          color: "var(--color-text-secondary)",
          whiteSpace: "pre-wrap",
        }}>
          {tip.body}
        </div>
      </div>
      {tips.length > 1 && (
        <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
          {tips.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === index % tips.length ? "12px" : "4px",
                height: "4px", borderRadius: "99px",
                background: i === index % tips.length
                  ? "var(--color-brand)"
                  : "var(--color-bg-tertiary)",
                transition: "width 0.2s, background 0.2s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
