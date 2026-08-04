// src/components/common/ChunkDownloadGate.tsx
//
// 【設計意図】
// React.lazy(lib/lazyWithRetry.ts)でラップした重量級コンポーネントに、閾値超えチャンクの
// ダウンロード確認を挟むための薄いラッパー。<LazyComp/> をレンダーした瞬間に
// React.lazy 内部で dynamic import() が発火するため、「確認前に読み込ませない」ためには
// 確認が終わるまで <LazyComp/> 自体をそもそもレンダーしないことが必要。
// このコンポーネント自身は lazy ではない通常コンポーネントとして、承認するまで
// LazyComp を子として描画しない（＝importを発火させない）。
//
// ゲート判定は同期（lib/chunkSizeGate.ts の resolveChunkGateStatus）。非同期のfetch待ちを
// 挟むと初回表示の体感速度が悪化するため意図的に同期にしている（詳細はchunkSizeGate.tsのコメント）。
// 閾値を超えるチャンクが実在しない現時点では常に approved になり、実際には発火しない
// （将来チャンクが育ったときに自動で効く）。

import { useState } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { useT } from "../../hooks/useT";
import {
  getKnownChunkGzipBytes,
  resolveChunkGateStatus,
  isChunkDownloadApproved,
  markChunkDownloadApproved,
} from "../../lib/chunkSizeGate";

function ChunkConfirmPrompt({
  gzipBytes,
  onApprove,
  onDecline,
  declined,
}: {
  gzipBytes: number;
  onApprove: () => void;
  onDecline: () => void;
  declined: boolean;
}) {
  const t = useT();
  const sizeKb = Math.ceil(gzipBytes / 1024);
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "12px", padding: "48px 24px", textAlign: "center", minHeight: "200px",
      }}
    >
      <p style={{ margin: 0, color: "var(--color-text-secondary)", maxWidth: "360px" }}>
        {declined ? t("common.chunkGate.declinedNotice") : t("common.chunkGate.message", { size: sizeKb })}
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onApprove}
          style={{
            padding: "8px 16px", borderRadius: "var(--radius-md)", border: "none",
            background: "var(--color-accent-primary, #3b82f6)", color: "#fff",
            fontWeight: 600, cursor: "pointer",
          }}
        >
          {t("common.chunkGate.approve")}
        </button>
        {!declined && (
          <button
            onClick={onDecline}
            style={{
              padding: "8px 16px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border-primary)", background: "transparent",
              color: "var(--color-text-secondary)", cursor: "pointer",
            }}
          >
            {t("common.chunkGate.decline")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * lazyWithRetry() で作った LazyExoticComponent を、ダウンロード確認ゲート付きに変換する。
 * chunkName は vite.config.ts の chunk-size-manifest プラグインが書き出すチャンク名と
 * 一致させること（＝lazyWithRetry(factory, name) の name と同じ文字列を渡す）。
 */
export function withChunkDownloadGate<P extends object>(
  LazyComp: LazyExoticComponent<ComponentType<P>>,
  chunkName: string,
): ComponentType<P> {
  // ジェネリックPをそのままJSXへspreadするとTSの分散変性チェックに引っかかるため、
  // このコンポーネント内部だけ緩めた型で受ける（呼び出し側のComponentType<P>という
  // 型安全なシグネチャは変えない）。
  const AnyLazyComp = LazyComp as unknown as ComponentType<Record<string, unknown>>;

  return function ChunkGated(props: P) {
    const [approved, setApproved] = useState<boolean>(() => {
      const status = resolveChunkGateStatus(getKnownChunkGzipBytes(chunkName), isChunkDownloadApproved(chunkName));
      return status === "approved";
    });
    const [declined, setDeclined] = useState(false);

    if (!approved) {
      return (
        <ChunkConfirmPrompt
          gzipBytes={getKnownChunkGzipBytes(chunkName) ?? 0}
          declined={declined}
          onApprove={() => {
            markChunkDownloadApproved(chunkName);
            setApproved(true);
            setDeclined(false);
          }}
          onDecline={() => setDeclined(true)}
        />
      );
    }

    return <AnyLazyComp {...(props as Record<string, unknown>)} />;
  };
}
