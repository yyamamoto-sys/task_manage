// src/components/guide/GuideOverlay.tsx
//
// 【設計意図】
// アプリ内ガイド表示用の汎用オーバーレイ。OkrDashboardView の履歴・概要オーバーレイと同パターン。
// HelpButton（？ボタン）と、GuideModeView の記事表示の両方から使う。
//
// 【2026-08-20追記】createPortal(document.body) で描画する。この`position:"fixed"`要素は、
// 呼び出し元（例：ConsultationPanel.tsx の非inline時。`transform: translateX(...)`を持つ）の
// DOM子孫としてそのまま描画すると、CSSの仕様上 transform を持つ祖先が containing block を
// すり替えてしまい、`position:"fixed"`が「ビューポート基準」ではなく「その祖先基準」になる
// （2026-08-20の横断監査で発覚。実際の視覚的な破綻は未検証だが、原因はCSS仕様上確実なため
// 先んじて塞いだ）。Portalでbody直下に描画すれば、呼び出し元がどんなstyleを持っていても
// 常にビューポート基準で正しく全画面表示される。呼び出し先は本ファイルとAdminView.tsx
// （直接呼び出し）・HelpButton.tsx（lazy）の2箇所のみであることを確認済み。

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { MarkdownLite } from "../common/MarkdownLite";
import { getDocByMode, getDocBySlug } from "../../lib/docs/manifest";
import type { DocEntry } from "../../lib/docs/types";

interface Props {
  /** mode キー（"okr.note" など）。slug より優先。 */
  modeKey?: string;
  /** slug（"02_modes/okr/01_meeting-note"）。modeKey が未指定の時に使う。 */
  slug?: string;
  /** 直接 DocEntry を渡す場合。最優先。 */
  entry?: DocEntry;
  onClose: () => void;
}

export function GuideOverlay({ modeKey, slug, entry, onClose }: Props) {
  const doc = useMemo<DocEntry | undefined>(() => {
    if (entry) return entry;
    if (modeKey) return getDocByMode(modeKey);
    if (slug) return getDocBySlug(slug);
    return undefined;
  }, [entry, modeKey, slug]);

  return createPortal(
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* イベントバブリング防止用のラッパー（クリックしても何も起きない） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="panel-slide-up"
        style={{
          width: "min(760px, 100vw)",
          background: "var(--color-bg-primary)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "18px" }}>📖</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
              {doc?.title ?? "ガイド"}
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              {doc
                ? <>最終更新 {doc.last_updated || "—"}{doc.owner ? `・担当 ${doc.owner}` : ""}{doc.deprecated ? "・⚠ 旧仕様" : ""}</>
                : "該当ページが見つかりませんでした"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1,
            }}
          >✕</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {!doc && (
            <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px 0" }}>
              {modeKey && <>mode キー <code>{modeKey}</code> に対応するガイドはまだ書かれていません。<br />docs/guides/ 配下に該当 mode を持つ MD を追加すると、ここに表示されます。</>}
              {!modeKey && slug && <>slug <code>{slug}</code> のガイドが見つかりませんでした。</>}
            </div>
          )}
          {doc && <MarkdownLite text={doc.body} />}
          {doc && doc.related && doc.related.length > 0 && (
            <div style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px solid var(--color-border-primary)" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px", letterSpacing: "0.06em" }}>関連</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {doc.related.map(r => {
                  const target = getDocByMode(r);
                  return (
                    <span key={r} style={{
                      fontSize: "11px", padding: "3px 9px",
                      background: target ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                      color: target ? "var(--color-brand)" : "var(--color-text-tertiary)",
                      borderRadius: "var(--radius-full)",
                      border: `1px solid ${target ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                    }}>{target?.title ?? r}</span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
