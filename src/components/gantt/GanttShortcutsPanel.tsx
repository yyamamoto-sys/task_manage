// src/components/gantt/GanttShortcutsPanel.tsx
//
// 【設計意図】
// ガントビュー固有の「見えない操作」（Ctrl+クリックの複数選択・バー中央/端のドラッグ・
// 端の外側の点での結線など）を発見できるようにする常設ショートカット一覧。
//
// 【非モーダルであることが最重要要件】
// - 全画面バックドロップは置かない（背景をクリック/ドラッグして塞がない）。
// - 閉じるのは✕ボタンのみ。クリックアウトサイド・Escapeでは閉じない
//   （Escapeはガント側で「選択解除／結線キャンセル」に使われており競合するため、
//   このパネルには絶対にEscapeクローズをバインドしないこと）。
// - パネルを開いたままガント本体のドラッグ・クリック操作が行えることが要件。
//
// 【ポータルのpointer-events罠】globals.css で body { pointer-events:none } と
// #root { pointer-events:auto } が設定されているため、createPortal(..., document.body) で
// #root の外に描画するこのパネルは、ルート要素に pointerEvents:"auto" を必ず明示しないと
// 一切クリックできなくなる（過去に ErrorBar の HistoryPanel・GanttPreviewPanel で同じ漏れが
// 発生し修正済み。CLAUDE.md v2.33参照）。

import { createPortal } from "react-dom";

interface ShortcutItem {
  gesture: string;
  description: string;
}

const MOUSE_SHORTCUTS: ShortcutItem[] = [
  { gesture: "Ctrl / Cmd + クリック", description: "タスクを複数選択（トグル）" },
  { gesture: "Shift + クリック", description: "直前に選択したタスク〜クリックしたタスクまでを表示順に範囲選択" },
  { gesture: "選択中バーの中央をドラッグ", description: "選択した複数タスクをまとめて日付シフト" },
  { gesture: "バー中央をドラッグ", description: "タスク全体を移動（開始日・期日を同時にずらす）" },
  { gesture: "バー左端をドラッグ", description: "開始日を変更" },
  { gesture: "バー右端をドラッグ", description: "期日を変更" },
  { gesture: "バー端の外側の点をドラッグ（🔗依存ON時）", description: "依存関係（先行→後続）を結線" },
  { gesture: "バーをクリック", description: "タスク詳細を開く" },
  { gesture: "空白をクリック", description: "選択を解除" },
];

const KEY_SHORTCUTS: ShortcutItem[] = [
  { gesture: "Esc", description: "選択解除、または結線操作のキャンセル" },
  { gesture: "T", description: "今日の位置へジャンプ" },
  { gesture: "+ / =　・　- / _", description: "ズームイン／ズームアウト" },
  { gesture: "Ctrl / Cmd + A", description: "現在表示中の全タスクを選択" },
  { gesture: "Enter", description: "1件選択中のタスクの詳細を開く（複数選択時は何もしない）" },
];

const TOGGLE_SHORTCUTS: ShortcutItem[] = [
  { gesture: "🔗依存", description: "依存関係の矢印・結線ハンドルの表示/非表示" },
  { gesture: "▤ベースライン", description: "当初計画（ベースライン）とのゴーストバー比較" },
  { gesture: "🙈完了を隠す", description: "完了タスクを非表示（未完了の子を持つ親は残す）" },
  { gesture: "🎯クリティカルパス", description: "所要期間を決める最長の依存連鎖を強調" },
  { gesture: "⚠過負荷", description: "人別ビューで同時アクティブタスクの重なりを強調" },
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

interface GanttShortcutsPanelProps {
  onClose: () => void;
}

export function GanttShortcutsPanel({ onClose }: GanttShortcutsPanelProps) {
  return createPortal(
    // 【非モーダル】背景バックドロップは意図的に置かない。パネルの外側は常にクリック・
    // ドラッグ可能なままにし、ガント本体の操作を一切妨げない。
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
          ガントのショートカット
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
      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
            マウス操作
          </div>
          <ShortcutList items={MOUSE_SHORTCUTS} />
        </div>
        <div>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
            キーボード
          </div>
          <ShortcutList items={KEY_SHORTCUTS} />
        </div>
        <div>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
            ツールバーのトグル
          </div>
          <ShortcutList items={TOGGLE_SHORTCUTS} />
        </div>
      </div>
    </div>,
    document.body
  );
}
