// src/components/project/ProjectRowMenu.tsx
//
// 【設計意図】
// サイドバーのPJ行の「⋮」操作メニュー（このPJの設定を開く／完了にする／アーカイブ／
// activeに戻す）。CustomSelect.tsx と同じ「トリガーの getBoundingClientRect() から fixed
// 座標を算出し、Portal で document.body 直下に描画する」方式を流用する（サイドバーは幅196px
// しかなくパネルの表示領域が収まらないため、absolute配置ではなく fixed + Portal が必要）。
//
// 【2026-08-20訂正】このコメント・CLAUDE.md Section 8には元々「CustomSelect.tsxと同じ…
// 画面外にはみ出さないよう右端・下端をクランプする」と書かれていたが、実際にはCustomSelect.tsx
// 自身はクランプを一切持っておらず記述が誤りだった（横断監査で発覚。CustomSelect.tsx/
// InlineEditAssignee.tsx/MentionTextarea.tsxが画面外へのはみ出しで操作不能になる不具合が
// 実際にあった）。2026-08-20に、このファイルが元々持っていたクランプ・反転ロジックを
// 共通ユーティリティ `computeFloatingPanelPosition`（src/lib/layout/floatingPanelPosition.ts）
// に切り出し、CustomSelect.tsx/InlineEditAssignee.tsx/MentionTextarea.tsxの4箇所全てが
// これを使うように揃えた（このファイルもcalcPanelStyle内でこの関数を呼ぶ形に変更済み）。
//
// 【CLAUDE.md Section 21（中央寄せモーダルの高さ上限契約）の対象外】
// このパネルは alignItems:center + justifyContent:center で画面中央に固定表示する「モーダル」
// ではなく、CustomSelect.tsx のドロップダウンパネルと同種の「トリガーに追従する一時的な
// 小さいポップオーバー」。position:fixed だが inset:0 を使わないため、そもそも
// modalStyles.test.ts の検出パターン（中央寄せの全画面オーバーレイ）に一致しない
// （CustomSelect.tsx が EXCLUDED_FILES に入っていないのと同じ理由。除外リストへの追記も
// 不要と判断した）。
//
// 何を出すか（状態変更ボタンの組み立て）は lib/project/projectRowMenu.ts の
// buildProjectRowMenuItems（純粋関数・テスト済み）に任せる。このファイルはUI（表示・
// 位置決め・開閉・クリックの実行）だけを持つ。

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { buildProjectRowMenuItems, type ProjectRowMenuActionId } from "../../lib/project/projectRowMenu";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";

const ITEM_LABEL_KEY: Record<ProjectRowMenuActionId, string> = {
  settings: "layout.sidebar.pjRowMenu.settings",
  complete: "layout.sidebar.pjRowMenu.complete",
  archive:  "layout.sidebar.pjRowMenu.archive",
  restore:  "layout.sidebar.pjRowMenu.restore",
};

interface Props {
  projectName: string;
  projectStatus: "active" | "completed" | "archived";
  canEdit: boolean;
  isGuest: boolean;
  /** 選択中のPJのときtrue。ホバー・フォーカスに関わらず常に⋮を表示する */
  forceVisible: boolean;
  onSelectAction: (id: ProjectRowMenuActionId) => void;
}

const PANEL_WIDTH = 190;
const VIEWPORT_MARGIN = 8;
/** 1項目あたりの高さ（padding 7px×2 + 行送り）＋パネルの padding 4px×2 */
const ITEM_HEIGHT = 34;
const PANEL_PADDING = 8;
/** 余白が足りないときでもこれ以上は縮めない（項目が1つも読めない状態にしない） */
const PANEL_MIN_HEIGHT = 76;

export function ProjectRowMenu({ projectName, projectStatus, canEdit, isGuest, forceVisible, onSelectAction }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const items = buildProjectRowMenuItems({ project: { status: projectStatus }, canEdit, isGuest });

  // 位置決め・スクロール追従・スクロール連鎖の遮断は共通フックに集約（src/hooks/useFloatingPanel.ts）。
  // 希望の高さは「全項目が入る高さ」。余白が足りなければフックが縮めてスクロールさせる。
  const { panelStyle, scrollAreaStyle } = useFloatingPanel({
    open,
    onRequestClose: () => setOpen(false),
    triggerRef,
    panelRef,
    align: "right",
    width: PANEL_WIDTH,
    margin: VIEWPORT_MARGIN,
    preferredMaxHeight: items.length * ITEM_HEIGHT + PANEL_PADDING,
    minMaxHeight: PANEL_MIN_HEIGHT,
  });

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation(); // 行本体のonSelectProjectクリックへの伝播を防ぐ
    setOpen(v => !v);
  };

  // 外側クリックで閉じる（トリガー・パネルの両方は除外）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escapeで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (items.length === 0) return null; // ゲスト等：⋮自体を出さない

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("layout.sidebar.pjRowMenu.ariaLabel", { name: projectName })}
        className={`pj-row-menu-trigger${forceVisible || open ? " force-visible" : ""}`}
        style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22,
          background: "transparent", border: "none", cursor: "pointer",
          borderRadius: "0 var(--radius-md) var(--radius-md) 0",
          color: "var(--color-text-tertiary)",
          fontSize: "13px", lineHeight: 1, padding: 0,
        }}
      >
        ⋮
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="animate-dropdown"
          style={{
            ...panelStyle,
            ...scrollAreaStyle,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "4px",
            pointerEvents: "auto",
          }}
        >
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onSelectAction(item.id); }}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", gap: "8px",
                padding: "7px 10px",
                fontSize: "12px", textAlign: "left",
                border: "none", borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: "var(--color-text-primary)",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: "12px", flexShrink: 0 }}>{item.icon}</span>
              {t(ITEM_LABEL_KEY[item.id])}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
