// src/components/okr/OkrDashboardView.tsx
//
// OKRモードのメインビュー。「日々の仕事と OKR をつなぐ地図」（components/okr/map/）を出す。
// 設計の記録＝docs/dev/sections/s91_okr-map-stage1.md（OKRモード作り直し 段階1）。
//
// 旧来の個人OKR（KRごとの月次計画・週の目標状態・自己評価◯△✕・メモ）は、地図の「わたし」の
// 「個人OKRの記録を開く」から開く。見た目は段階4で地図に寄せた（s91 91-4）。
// 【2026-08-10・アーカイブ】旧グループ側の機能は src/components/okr/ARCHIVED.md 参照。

import { Suspense, useEffect, useState } from "react";
import type { Member } from "../../lib/localData/types";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { withChunkDownloadGate } from "../common/ChunkDownloadGate";
import { withBellReserve } from "../../lib/layout/topRightBell";
import { confirmDiscardUnsavedEdits } from "../../lib/editing/unsavedEditorRegistry";
import { OkrMapView } from "./map/OkrMapView";
import { useOkrMapBridge } from "./map/bridge";
import { OkrLogo } from "./okrTheme";
import "./okrTheme.css";

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
  // ガイドから OKR のツアーを再生するときは、ツアーの対象がある個人OKRの記録の画面から始める（91-6 C9）
  const tourPending = useOkrMapBridge((s) => s.personalTourPending);
  const [personalOpen, setPersonalOpen] = useState(tourPending);
  useEffect(() => {
    if (tourPending) setPersonalOpen(true);
  }, [tourPending]);

  // ガイドから地図のツアーを再生するときは、個人OKRの記録を開いていても地図へ戻す。未保存の編集を捨てない場合は取り下げる
  const mapTourPending = useOkrMapBridge((s) => s.mapTourPending);
  useEffect(() => {
    if (!mapTourPending || !personalOpen) return;
    void confirmDiscardUnsavedEdits().then(ok => {
      if (ok) setPersonalOpen(false);
      else useOkrMapBridge.getState().setMapTourPending(false);
    });
  }, [mapTourPending, personalOpen]);

  if (!personalOpen) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OkrMapView
          currentUser={currentUser}
          headerPadRight={withBellReserve(24)}
          // 地図の KR の段の基準文の書きかけ（明示保存）が消えるので、未保存の確認を通す（Section 46・47）
          onOpenPersonalOkr={() => { void confirmDiscardUnsavedEdits().then(ok => { if (ok) setPersonalOpen(true); }); }}
        />
      </div>
    );
  }

  // 見た目は地図の帯（.mk-head・.mk-btn・.mk-h1。map/mock*.css は上の OkrMapView の import で常に読み込まれている）と
  // 共通トークン（okrTheme.css）に寄せる（Section 91-4）
  return (
    <div className="okr-personal" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="okr-personal-top">
        <header className="mk-head" style={{ flexWrap: "wrap", paddingRight: withBellReserve(24) }}>
          <button
            type="button"
            className="mk-btn mk-btn-sm"
            // 個人OKRの「今月の計画」「振り返り」欄は明示保存なので、閉じる前に未保存の確認を通す（Section 46・52）
            onClick={() => { void confirmDiscardUnsavedEdits().then(ok => { if (ok) setPersonalOpen(false); }); }}
            style={{ flexShrink: 0, whiteSpace: "nowrap", cursor: "pointer" }}
          >
            ← 地図へ戻る
          </button>
          <div className="mk-head-title" style={{ flexShrink: 0 }}>
            <OkrLogo />
            <div>
              <div className="okr-crumb">OKRモード ／ わたし</div>
              <h1 className="mk-h1" style={{ margin: 0 }}>個人OKRの記録</h1>
              <div className="mk-concept">KRごとの月次計画・週の目標状態と自己評価（◯△✕）・メモを記録します</div>
            </div>
          </div>
        </header>
      </div>

      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>}>
        <PersonalOkrView currentUser={currentUser} />
      </Suspense>
    </div>
  );
}
