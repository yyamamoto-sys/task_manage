// src/components/okr/OkrDashboardView.tsx
//
// OKRモードのメインビュー。「日々の仕事と OKR をつなぐ地図」（components/okr/map/）を出す。
// 設計の記録＝docs/dev/sections/s91_okr-map-stage1.md（OKRモード作り直し 段階1）。
//
// 旧来の個人OKR（KRごとの月次計画・週の目標状態・自己評価◯△✕・メモ）は、地図の「わたし」の
// 「個人OKRの記録を開く」から開く（段階4で見た目を地図に寄せるまでは、今の画面のまま）。
// 【2026-08-10・アーカイブ】旧グループ側の機能は src/components/okr/ARCHIVED.md 参照。

import { Suspense, useState } from "react";
import type { Member } from "../../lib/localData/types";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { withChunkDownloadGate } from "../common/ChunkDownloadGate";
import { withBellReserve } from "../../lib/layout/topRightBell";
import { confirmDiscardUnsavedEdits } from "../../lib/editing/unsavedEditorRegistry";
import { OkrMapView } from "./map/OkrMapView";

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
  const [personalOpen, setPersonalOpen] = useState(false);

  if (!personalOpen) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OkrMapView currentUser={currentUser} headerPadRight={withBellReserve(24)} onOpenPersonalOkr={() => setPersonalOpen(true)} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{
        padding: "10px 20px",
        paddingRight: withBellReserve(20),
        borderBottom: "1px solid var(--color-border-primary)",
        background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.04))",
        display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <button
          type="button"
          // 個人OKRの「今月の計画」「振り返り」欄は明示保存なので、閉じる前に未保存の確認を通す（Section 46・52）
          onClick={() => { void confirmDiscardUnsavedEdits().then(ok => { if (ok) setPersonalOpen(false); }); }}
          style={{
            flexShrink: 0, whiteSpace: "nowrap", padding: "4px 10px", fontSize: "12px",
            border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
            background: "var(--color-bg-primary)", color: "var(--color-text-secondary)", cursor: "pointer",
          }}
        >
          ← 地図へ戻る
        </button>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", lineHeight: 1.3 }}>
            個人OKRの記録
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
            KRごとの月次計画・週の目標状態と自己評価（◯△✕）・メモを記録します
          </div>
        </div>
      </div>

      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>}>
        <PersonalOkrView currentUser={currentUser} />
      </Suspense>
    </div>
  );
}
