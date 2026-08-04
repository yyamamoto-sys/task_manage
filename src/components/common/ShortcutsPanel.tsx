// src/components/common/ShortcutsPanel.tsx
//
// 【設計意図】
// 全ビュー共通のショートカット一覧パネル（旧 gantt/GanttShortcutsPanel を汎用化したもの）。
// 「どのショートカットがどのビューで効くか」をスコープ別（全ビュー共通／リスト／カンバン／ガント）に
// セクション分けして1つのパネルにまとめる。定義は本ファイルの buildSections() 1箇所にまとめてあり、
// 新しいビューにショートカットが増えたらここに1セクション追記すればよい。
// 【表示フィルタ】現在のビューで実際に使えないショートカットを混乱させないため、表示するのは
// 「全ビュー共通」セクション＋現在のビューに対応するセクションのみ（他ビューのセクションは出さない）。
// list/kanban/gantt に対応するビューにいないとき（ダッシュボード・ワークロード・管理画面・OKR等）は
// 「全ビュー共通」だけを表示する。
//
// 【非モーダルであることが最重要要件（旧GanttShortcutsPanelから踏襲）】
// - 全画面バックドロップは置かない（背景をクリック/ドラッグして塞がない）。
// - 閉じるのは✕ボタンのみ。クリックアウトサイド・Escapeでは閉じない
//   （Escapeは各ビューで「選択解除」「結線キャンセル」等に使われており競合するため、
//   このパネルには絶対にEscapeクローズをバインドしないこと）。
// - パネルを開いたまま各ビュー本体の操作（クリック・ドラッグ・キーボード操作）が行えることが要件。
//
// 【ポータルのpointer-events罠】globals.css で body { pointer-events:none } と
// #root { pointer-events:auto } が設定されているため、createPortal(..., document.body) で
// #root の外に描画するこのパネルは、ルート要素に pointerEvents:"auto" を必ず明示しないと
// 一切クリックできなくなる（過去に ErrorBar の HistoryPanel・GanttPreviewPanel・旧
// GanttShortcutsPanel で同じ漏れが発生し修正済み。CLAUDE.md v2.33参照）。
//
// 【i18n（Phase 1）】全文言をt()経由にしたため、SECTIONSはmodule定数ではなく
// buildSections(t) 関数にした（tはレンダー時のuseT()の戻り値を渡す）。

import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { ViewMode } from "../../lib/localData/types";
import { useT } from "../../hooks/useT";

interface ShortcutItem {
  gesture: string;
  description: string;
}

interface ShortcutGroup {
  label: string;
  items: ShortcutItem[];
}

interface ShortcutSection {
  key: "common" | "list" | "kanban" | "gantt";
  title: string;
  /** このセクションが対応するビュー。全ビュー共通セクションは null */
  view: ViewMode | null;
  groups: ShortcutGroup[];
}

type TFn = ReturnType<typeof useT>;

function buildSections(t: TFn): ShortcutSection[] {
  return [
    {
      key: "common", title: t("common.shortcuts.section.common.title"), view: null,
      groups: [{
        label: t("common.shortcuts.section.common.kb.label"),
        items: [
          { gesture: t("common.shortcuts.section.common.kb.item1.gesture"), description: t("common.shortcuts.section.common.kb.item1.desc") },
          { gesture: t("common.shortcuts.section.common.kb.item2.gesture"), description: t("common.shortcuts.section.common.kb.item2.desc") },
        ],
      }],
    },
    {
      key: "list", title: t("common.shortcuts.section.list.title"), view: "list",
      groups: [
        {
          label: t("common.shortcuts.section.list.mk.label"),
          items: [
            { gesture: t("common.shortcuts.section.list.mk.item1.gesture"), description: t("common.shortcuts.section.list.mk.item1.desc") },
            { gesture: t("common.shortcuts.section.list.mk.item2.gesture"), description: t("common.shortcuts.section.list.mk.item2.desc") },
            { gesture: t("common.shortcuts.section.list.mk.item3.gesture"), description: t("common.shortcuts.section.list.mk.item3.desc") },
            { gesture: t("common.shortcuts.section.list.mk.item4.gesture"), description: t("common.shortcuts.section.list.mk.item4.desc") },
            { gesture: t("common.shortcuts.section.list.mk.item5.gesture"), description: t("common.shortcuts.section.list.mk.item5.desc") },
          ],
        },
        {
          label: t("common.shortcuts.section.list.toolbar.label"),
          items: [
            { gesture: t("common.shortcuts.section.list.toolbar.item1.gesture"), description: t("common.shortcuts.section.list.toolbar.item1.desc") },
          ],
        },
      ],
    },
    {
      key: "kanban", title: t("common.shortcuts.section.kanban.title"), view: "kanban",
      groups: [
        {
          label: t("common.shortcuts.section.kanban.mk.label"),
          items: [
            { gesture: t("common.shortcuts.section.kanban.mk.item1.gesture"), description: t("common.shortcuts.section.kanban.mk.item1.desc") },
            { gesture: t("common.shortcuts.section.kanban.mk.item2.gesture"), description: t("common.shortcuts.section.kanban.mk.item2.desc") },
            { gesture: t("common.shortcuts.section.kanban.mk.item3.gesture"), description: t("common.shortcuts.section.kanban.mk.item3.desc") },
            { gesture: t("common.shortcuts.section.kanban.mk.item4.gesture"), description: t("common.shortcuts.section.kanban.mk.item4.desc") },
            { gesture: t("common.shortcuts.section.kanban.mk.item5.gesture"), description: t("common.shortcuts.section.kanban.mk.item5.desc") },
            { gesture: t("common.shortcuts.section.kanban.mk.item6.gesture"), description: t("common.shortcuts.section.kanban.mk.item6.desc") },
          ],
        },
        {
          label: t("common.shortcuts.section.kanban.toolbar.label"),
          items: [
            { gesture: t("common.shortcuts.section.kanban.toolbar.item1.gesture"), description: t("common.shortcuts.section.kanban.toolbar.item1.desc") },
          ],
        },
      ],
    },
    {
      key: "gantt", title: t("common.shortcuts.section.gantt.title"), view: "gantt",
      groups: [
        {
          label: t("common.shortcuts.section.gantt.mouse.label"),
          items: [
            { gesture: t("common.shortcuts.section.gantt.mouse.item1.gesture"), description: t("common.shortcuts.section.gantt.mouse.item1.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item2.gesture"), description: t("common.shortcuts.section.gantt.mouse.item2.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item3.gesture"), description: t("common.shortcuts.section.gantt.mouse.item3.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item4.gesture"), description: t("common.shortcuts.section.gantt.mouse.item4.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item5.gesture"), description: t("common.shortcuts.section.gantt.mouse.item5.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item6.gesture"), description: t("common.shortcuts.section.gantt.mouse.item6.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item7.gesture"), description: t("common.shortcuts.section.gantt.mouse.item7.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item8.gesture"), description: t("common.shortcuts.section.gantt.mouse.item8.desc") },
            { gesture: t("common.shortcuts.section.gantt.mouse.item9.gesture"), description: t("common.shortcuts.section.gantt.mouse.item9.desc") },
          ],
        },
        {
          label: t("common.shortcuts.section.gantt.kb.label"),
          items: [
            { gesture: t("common.shortcuts.section.gantt.kb.item1.gesture"), description: t("common.shortcuts.section.gantt.kb.item1.desc") },
            { gesture: t("common.shortcuts.section.gantt.kb.item2.gesture"), description: t("common.shortcuts.section.gantt.kb.item2.desc") },
            { gesture: t("common.shortcuts.section.gantt.kb.item3.gesture"), description: t("common.shortcuts.section.gantt.kb.item3.desc") },
            { gesture: t("common.shortcuts.section.gantt.kb.item4.gesture"), description: t("common.shortcuts.section.gantt.kb.item4.desc") },
            { gesture: t("common.shortcuts.section.gantt.kb.item5.gesture"), description: t("common.shortcuts.section.gantt.kb.item5.desc") },
          ],
        },
        {
          label: t("common.shortcuts.section.gantt.toggle.label"),
          items: [
            { gesture: t("common.shortcuts.section.gantt.toggle.item1.gesture"), description: t("common.shortcuts.section.gantt.toggle.item1.desc") },
            { gesture: t("common.shortcuts.section.gantt.toggle.item2.gesture"), description: t("common.shortcuts.section.gantt.toggle.item2.desc") },
            { gesture: t("common.shortcuts.section.gantt.toggle.item3.gesture"), description: t("common.shortcuts.section.gantt.toggle.item3.desc") },
            { gesture: t("common.shortcuts.section.gantt.toggle.item4.gesture"), description: t("common.shortcuts.section.gantt.toggle.item4.desc") },
            { gesture: t("common.shortcuts.section.gantt.toggle.item5.gesture"), description: t("common.shortcuts.section.gantt.toggle.item5.desc") },
          ],
        },
      ],
    },
  ];
}

function ShortcutList({ items }: { items: ShortcutItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map(item => (
        <div key={item.gesture} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {item.gesture}
          </span>
          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            {item.description}
          </span>
        </div>
      ))}
    </div>
  );
}

interface ShortcutsPanelProps {
  /** 現在開いているビュー。対応するセクションのみを共通セクションの後ろに表示する */
  currentView: ViewMode | null;
  onClose: () => void;
}

export function ShortcutsPanel({ currentView, onClose }: ShortcutsPanelProps) {
  const t = useT();
  const SECTIONS = useMemo(() => buildSections(t), [t]);
  // 「全ビュー共通」は常に表示 + 現在のビューに対応するセクションがあればそれだけを追加。
  // 対応するセクションが無いビュー（ダッシュボード・ワークロード・管理画面・OKR等）は共通のみになる。
  const commonSection = SECTIONS.find(s => s.key === "common")!;
  const currentSection = currentView ? SECTIONS.find(s => s.view === currentView) : undefined;
  const orderedSections = [commonSection, ...(currentSection ? [currentSection] : [])];

  return createPortal(
    // 【非モーダル】背景バックドロップは意図的に置かない。パネルの外側は常にクリック・
    // ドラッグ可能なままにし、各ビュー本体の操作を一切妨げない。
    <div
      style={{
        position: "fixed", bottom: "44px", right: "16px", zIndex: 150,
        width: "min(340px, calc(100vw - 32px))",
        maxHeight: "70vh",
        display: "flex", flexDirection: "column",
        background: "var(--color-bg-primary)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
        overflow: "hidden",
        // 【ポータル注意】body{pointer-events:none}を打ち消すため必須。忘れるとパネル全体が
        // 一切クリックできなくなる（過去バグ・CLAUDE.md v2.33参照）。
        pointerEvents: "auto",
      }}
    >
      {/* ヘッダー */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 14px",
        borderBottom: "1px solid var(--color-border-primary)",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "12px" }}>⌨</span>
        <span style={{ flex: 1, fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {t("common.shortcuts.title")}
        </span>
        <button
          onClick={onClose}
          title={t("common.shortcuts.closeTitle")}
          aria-label={t("common.shortcuts.closeAriaLabel")}
          style={{
            padding: "2px 6px", fontSize: "14px",
            background: "transparent", border: "none",
            color: "var(--color-text-tertiary)",
            cursor: "pointer",
          }}
        >×</button>
      </div>

      {/* 中身 */}
      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {orderedSections.map(section => {
          const isCurrent = section === currentSection;
          return (
            <div
              key={section.key}
              style={isCurrent ? {
                borderLeft: "2px solid var(--color-brand)",
                paddingLeft: "10px",
                marginLeft: "-2px",
                background: "var(--color-brand-light)",
                borderRadius: "0 var(--radius-md) var(--radius-md) 0",
                padding: "6px 10px",
              } : undefined}
            >
              <div style={{
                fontSize: "10px", fontWeight: 700,
                color: isCurrent ? "var(--color-brand)" : "var(--color-text-tertiary)",
                marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px",
                textTransform: "uppercase", letterSpacing: "0.03em",
              }}>
                {section.title}
                {isCurrent && <span style={{ fontSize: "9px", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{t("common.shortcuts.currentViewSuffix")}</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {section.groups.map(group => (
                  <div key={group.label}>
                    <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
                      {group.label}
                    </div>
                    <ShortcutList items={group.items} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
