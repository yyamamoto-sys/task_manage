// src/components/common/ShortcutsPanel.tsx
//
// 【設計意図】
// 全ビュー共通のショートカット一覧パネル（旧 gantt/GanttShortcutsPanel を汎用化したもの）。
// 「どのショートカットがどのビューで効くか」をスコープ別（全ビュー共通／リスト／カンバン／ガント）に
// セクション分けして1つのパネルにまとめる。定義は本ファイルの SECTIONS 配列1箇所にまとめてあり、
// 新しいビューにショートカットが増えたらここに1セクション追記すればよい。
// 現在開いているビューに対応するセクションは、共通セクションの直後に並べ替えた上で軽く強調する。
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

import { createPortal } from "react-dom";
import type { ViewMode } from "../../lib/localData/types";

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

const SECTIONS: ShortcutSection[] = [
  {
    key: "common", title: "全ビュー共通", view: null,
    groups: [{
      label: "キーボード",
      items: [
        { gesture: "Ctrl / Cmd + K", description: "コマンドパレットを開く/閉じる（タスク・プロジェクトを横断検索）" },
        { gesture: "Ctrl / Cmd + Z", description: "直前の操作を元に戻す（削除や一括操作などUndo付きトーストが出た直後に有効。入力欄では代わりにブラウザ標準のテキストUndoが働く）" },
      ],
    }],
  },
  {
    key: "list", title: "リスト", view: "list",
    groups: [
      {
        label: "マウス／キーボード",
        items: [
          { gesture: "Ctrl / Cmd + A", description: "現在の絞り込み後の全タスクを選択" },
          { gesture: "Ctrl / Cmd + クリック（行）", description: "タスクを複数選択（トグル。詳細は開かない）" },
          { gesture: "Shift + クリック（行）", description: "直前に選択/クリックした行〜クリックした行までを表示順で範囲選択" },
          { gesture: "Esc", description: "選択を解除" },
          { gesture: "クリック（行）", description: "タスク詳細を開く（既存の選択は解除しない）" },
        ],
      },
      {
        label: "選択時のツールバー",
        items: [
          { gesture: "一括操作バー", description: "選択1件以上でステータス一括変更・担当者一括変更・一括削除ができる" },
        ],
      },
    ],
  },
  {
    key: "kanban", title: "カンバン", view: "kanban",
    groups: [
      {
        label: "マウス／キーボード",
        items: [
          { gesture: "Ctrl / Cmd + クリック（カード）", description: "カードを複数選択（トグル。詳細は開かない）" },
          { gesture: "Shift + クリック（カード）", description: "直前に選択/クリックしたカード〜クリックしたカードまでを表示順（列→列内上から下）で範囲選択" },
          { gesture: "Ctrl / Cmd + A", description: "表示中の全カードを選択" },
          { gesture: "Esc", description: "選択を解除" },
          { gesture: "クリック（カード）", description: "タスク詳細を開く" },
          { gesture: "選択中カードをドラッグ", description: "選択した複数カードをまとめて別列（ステータス）へ一括移動" },
        ],
      },
      {
        label: "選択時のツールバー",
        items: [
          { gesture: "一括操作バー", description: "選択1件以上でステータス一括変更・担当者一括変更・一括削除ができる" },
        ],
      },
    ],
  },
  {
    key: "gantt", title: "ガント", view: "gantt",
    groups: [
      {
        label: "マウス操作",
        items: [
          { gesture: "Ctrl / Cmd + クリック", description: "タスクを複数選択（トグル）" },
          { gesture: "Shift + クリック", description: "直前に選択したタスク〜クリックしたタスクまでを表示順に範囲選択" },
          { gesture: "選択中バーの中央をドラッグ", description: "選択した複数タスクをまとめて日付シフト" },
          { gesture: "バー中央をドラッグ", description: "タスク全体を移動（開始日・期日を同時にずらす）" },
          { gesture: "バー左端をドラッグ", description: "開始日を変更" },
          { gesture: "バー右端をドラッグ", description: "期日を変更" },
          { gesture: "バー端の外側の点をドラッグ（🔗依存ON時）", description: "依存関係（先行→後続）を結線" },
          { gesture: "バーをクリック", description: "タスク詳細を開く" },
          { gesture: "空白をクリック", description: "選択を解除" },
        ],
      },
      {
        label: "キーボード",
        items: [
          { gesture: "Esc", description: "選択解除、または結線操作のキャンセル" },
          { gesture: "T", description: "今日の位置へジャンプ" },
          { gesture: "+ / =　・　- / _", description: "ズームイン／ズームアウト" },
          { gesture: "Ctrl / Cmd + A", description: "現在表示中の全タスクを選択" },
          { gesture: "Enter", description: "1件選択中のタスクの詳細を開く（複数選択時は何もしない）" },
        ],
      },
      {
        label: "ツールバーのトグル",
        items: [
          { gesture: "🔗依存", description: "依存関係の矢印・結線ハンドルの表示/非表示" },
          { gesture: "▤ベースライン", description: "当初計画（ベースライン）とのゴーストバー比較" },
          { gesture: "🙈完了を隠す", description: "完了タスクを非表示（未完了の子を持つ親は残す）" },
          { gesture: "🎯クリティカルパス", description: "所要期間を決める最長の依存連鎖を強調" },
          { gesture: "⚠過負荷", description: "人別ビューで同時アクティブタスクの重なりを強調" },
        ],
      },
    ],
  },
];

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
  /** 現在開いているビュー。対応するセクションを共通セクションの直後に並べ替え、軽く強調する */
  currentView: ViewMode | null;
  onClose: () => void;
}

export function ShortcutsPanel({ currentView, onClose }: ShortcutsPanelProps) {
  // 「全ビュー共通」を先頭固定 → 現在のビューのセクション → 残り、の順に並べ替える
  const commonSection = SECTIONS.find(s => s.key === "common")!;
  const currentSection = currentView ? SECTIONS.find(s => s.view === currentView) : undefined;
  const otherSections = SECTIONS.filter(s => s.key !== "common" && s !== currentSection);
  const orderedSections = [commonSection, ...(currentSection ? [currentSection] : []), ...otherSections];

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
          ショートカット一覧
        </span>
        <button
          onClick={onClose}
          title="閉じる"
          aria-label="ショートカット一覧を閉じる"
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
                {isCurrent && <span style={{ fontSize: "9px", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>（今のビュー）</span>}
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
