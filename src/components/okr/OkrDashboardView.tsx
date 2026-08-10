// src/components/okr/OkrDashboardView.tsx
//
// OKRモードのメインビュー。個人OKR（KRごとの月次計画・週の目標状態・自己評価◯△✕・メモ）
// のみを表示する薄いラッパー。
//
// 【2026-08-10・アーカイブ】旧グループ側の機能（OKR管理サブタブ①〜③・なぜなぜ分析・
// クォーター計画タブ・OKR概要／セッション履歴オーバーレイ・「グループ／自分」切替seg）は
// 山本さんの判断で一旦白紙にし、コードのみアーカイブとして保管した
// （src/components/okr/ARCHIVED.md 参照。旧実装は GroupOkrDashboardArchived.tsx）。
// 選択肢が「個人」の1つだけになったため切替seg自体を撤去した。

import { Suspense } from "react";
import type { Member } from "../../lib/localData/types";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { withChunkDownloadGate } from "../common/ChunkDownloadGate";

// 個人OKRビューは重量級のためReact.lazyで分割し、閾値超えチャンクのダウンロード確認ゲートを
// 通す（CLAUDE.md Section 19）。
const PersonalOkrView = withChunkDownloadGate(
  lazyWithRetry(() => import("./personal/PersonalOkrView").then(m => ({ default: m.PersonalOkrView })), "PersonalOkrView"),
  "PersonalOkrView",
);

interface Props {
  currentUser: Member;
}

export function OkrDashboardView({ currentUser }: Props) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* モードヘッダー */}
      <div style={{
        padding: "10px 20px",
        borderBottom: "1px solid var(--color-border-primary)",
        background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.04))",
        display: "flex", alignItems: "center", gap: "10px",
        flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", lineHeight: 1.3 }}>
            個人OKRモード
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
            KRごとの月次計画・週の目標状態と自己評価（◯△✕）・メモを記録するモードです
          </div>
        </div>
      </div>

      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>}>
        <PersonalOkrView currentUser={currentUser} />
      </Suspense>
    </div>
  );
}
