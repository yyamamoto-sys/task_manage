// src/components/common/ChunkLoadFailed.tsx
//
// 遅延読み込みする画面のチャンクが取れなかったとき、その画面の位置（Suspense の中）に出す案内。
// 新しい版の公開でハッシュ付きファイル名が変わった古いタブで起きる。黙って reload せず、
// 未保存の編集を確認してから利用者が押したときだけ再読み込みする（v3.146・CLAUDE.md Section 76）。
// フックを使わない素の関数（テストを node 環境で直接呼べる。GuestAiQuotaNotice と同じ流儀）。

import { useLangStore } from "../../stores/langStore";
import { translate } from "../../lib/i18n";
import { reloadWithGuard } from "../../lib/reloadWithGuard";

export function ChunkLoadFailed() {
  const lang = useLangStore.getState().lang;
  return (
    <div
      role="alert"
      style={{
        margin: "24px auto", maxWidth: 560, padding: "14px 16px", fontSize: "13px",
        display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
        border: "1px solid var(--color-border-warning)", borderRadius: "var(--radius-md)",
      }}
    >
      <span style={{ flex: 1, minWidth: 200 }}>{translate(lang, "layout.app.chunkLoadFailed.body")}</span>
      <button
        onClick={() => { void reloadWithGuard(); }}
        style={{
          padding: "4px 12px", fontSize: "12px", fontWeight: 500,
          background: "var(--color-text-warning)", color: "#fff",
          border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
        }}
      >
        {translate(lang, "layout.app.chunkLoadFailed.reload")}
      </button>
    </div>
  );
}
