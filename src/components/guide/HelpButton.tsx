// src/components/guide/HelpButton.tsx
//
// 【設計意図】
// 各パネルに置く小さな「？」ボタン。modeKey で指定されたガイドを GuideOverlay で開く。
// docs/guides/**/*.md の frontmatter `mode:` キーと一致するページが表示される。
// 一致するページがまだ無くてもクリックは可能（オーバーレイ側で「未作成」を表示）。
//
// 【グランドルール（v3.20・CLAUDE.md Section 19）】
// GuideOverlay は src/lib/docs/manifest.ts（全ガイドMD・gzip約26.7KB）を静的importしている。
// HelpButton 自体は MainLayout.tsx / ConsultationPanel.tsx から静的にimportされる（＝常時ロード
// されるアプリ本体の一部）ため、ここで同期importすると「？」を一度も押さないユーザーにも
// 全ガイド本文を毎回ダウンロードさせてしまう。MainLayout.tsx の既存パターンに揃え、
// lazyWithRetry + withChunkDownloadGate で「押したときだけ」読み込む。

import { Suspense, useState } from "react";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { withChunkDownloadGate } from "../common/ChunkDownloadGate";
import { Skeleton } from "../common/Skeleton";

const GuideOverlay = withChunkDownloadGate(
  lazyWithRetry(() => import("./GuideOverlay").then(m => ({ default: m.GuideOverlay })), "GuideOverlay"),
  "GuideOverlay",
);

/** GuideOverlay のチャンク読込中に表示する軽量フォールバック。骨格をGuideOverlayに合わせて違和感を無くす。 */
function GuideOverlayLoading({ onClose }: { onClose: () => void }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(760px, 100vw)",
          background: "var(--color-bg-primary)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
          padding: "20px 24px", gap: "14px",
        }}
      >
        <Skeleton width={160} height={16} />
        <Skeleton width="90%" height={12} />
        <Skeleton width="80%" height={12} />
        <Skeleton width="60%" height={12} />
      </div>
    </div>
  );
}

interface Props {
  modeKey: string;
  /** 表示テキスト。省略時は "?"。 */
  label?: string;
  /** ボタンサイズ（small=20px 円形 / inline=テキスト風）。 */
  variant?: "small" | "inline";
  title?: string;
}

export function HelpButton({ modeKey, label, variant = "small", title }: Props) {
  const [open, setOpen] = useState(false);

  const small: React.CSSProperties = {
    width: "22px", height: "22px", borderRadius: "50%",
    border: "1px solid var(--color-border-primary)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-tertiary)",
    fontSize: "12px", fontWeight: 700, lineHeight: 1,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", padding: 0, flexShrink: 0,
  };
  const inline: React.CSSProperties = {
    fontSize: "11px", padding: "3px 9px",
    background: "transparent",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-full)",
    color: "var(--color-text-secondary)", cursor: "pointer",
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title ?? "このページのガイドを開く"}
        aria-label={title ?? "このページのガイドを開く"}
        style={variant === "small" ? small : inline}
      >
        {label ?? (variant === "small" ? "?" : "📖 ガイド")}
      </button>
      {open && (
        <Suspense fallback={<GuideOverlayLoading onClose={() => setOpen(false)} />}>
          <GuideOverlay modeKey={modeKey} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
