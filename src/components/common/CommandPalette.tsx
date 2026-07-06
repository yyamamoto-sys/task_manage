// src/components/common/CommandPalette.tsx
//
// Ctrl+K / Cmd+K で開く横断検索＆ジャンプパレット。
// タスク・プロジェクトを名前で検索し、選択でタスク編集モーダル／PJ選択へジャンプする。
// クイックアクション（ビュー切替・新規タスク・AI相談）も提供。
// キーボード操作：↑↓で移動・Enterで実行・Escで閉じる。

import { useState, useEffect, useMemo, useRef } from "react";
import type { Task, Project, ViewMode } from "../../lib/localData/types";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE } from "../../lib/taskMeta";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];        // スコープ済み・非削除
  projects: Project[];  // アクティブPJ
  canCreate: boolean;   // ゲストは新規タスク等の作成アクションを出さない
  onOpenTask: (taskId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSwitchView: (view: ViewMode) => void;
  onQuickAdd: () => void;
  onOpenConsult: () => void;
}

type PaletteItem =
  | { kind: "task"; id: string; label: string; sub: string; task: Task }
  | { kind: "project"; id: string; label: string; color: string }
  | { kind: "action"; id: string; label: string; icon: string; run: () => void };

const VIEW_ACTIONS: { view: ViewMode; label: string; icon: string }[] = [
  { view: "dashboard", label: "ダッシュボードを開く", icon: "📊" },
  { view: "kanban",    label: "カンバンを開く",       icon: "📋" },
  { view: "gantt",     label: "ガントを開く",         icon: "📅" },
  { view: "list",      label: "リストを開く",         icon: "📝" },
];

export function CommandPalette({
  isOpen, onClose, tasks, projects, canCreate,
  onOpenTask, onSelectProject, onSwitchView, onQuickAdd, onOpenConsult,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 開くたびに状態をリセットして入力欄にフォーカス
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      // Suspense/アニメーション後に確実にフォーカスするため1フレーム遅延
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const projectNameById = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  // 検索結果（グループ順：アクション → PJ → タスク）
  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    // クイックアクション：クエリが空 or ラベルに部分一致
    const actions: PaletteItem[] = [
      ...VIEW_ACTIONS.map(v => ({
        kind: "action" as const, id: `view_${v.view}`, label: v.label, icon: v.icon,
        run: () => onSwitchView(v.view),
      })),
      ...(canCreate ? [{
        kind: "action" as const, id: "quick_add", label: "新規タスクを追加", icon: "＋",
        run: onQuickAdd,
      }] : []),
      {
        kind: "action" as const, id: "consult", label: "AIに相談する", icon: "✨",
        run: onOpenConsult,
      },
    ];
    result.push(...(q === "" ? actions : actions.filter(a => a.label.toLowerCase().includes(q))));

    if (q !== "") {
      // プロジェクト（名前部分一致・最大5件）
      projects
        .filter(p => p.name.toLowerCase().includes(q))
        .slice(0, 5)
        .forEach(p => result.push({ kind: "project", id: p.id, label: p.name, color: p.color_tag ?? "var(--color-brand)" }));

      // タスク（名前部分一致・未完了を先に・最大8件）
      const matched = tasks.filter(t => t.name.toLowerCase().includes(q));
      matched.sort((a, b) => {
        const ad = a.status === "done" ? 1 : 0;
        const bd = b.status === "done" ? 1 : 0;
        return ad - bd;
      });
      matched.slice(0, 8).forEach(t => result.push({
        kind: "task", id: t.id, label: t.name,
        sub: [
          t.project_id ? projectNameById.get(t.project_id) : null,
          TASK_STATUS_LABEL[t.status],
          t.due_date ? `期日 ${t.due_date.slice(5).replace("-", "/")}` : null,
        ].filter(Boolean).join(" ・ "),
        task: t,
      }));
    }
    return result;
  }, [query, tasks, projects, projectNameById, canCreate, onSwitchView, onQuickAdd, onOpenConsult]);

  // 結果が変わったら選択位置を先頭へ
  useEffect(() => { setSelectedIndex(0); }, [items.length, query]);

  // 選択中の行を常に可視範囲へスクロール
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const runItem = (item: PaletteItem) => {
    onClose();
    if (item.kind === "task") onOpenTask(item.id);
    else if (item.kind === "project") onSelectProject(item.id);
    else item.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && items[selectedIndex]) { e.preventDefault(); runItem(items[selectedIndex]); }
  };

  // グループ見出し：直前のitemとkindが変わる位置にだけ出す
  const groupLabel = (kind: PaletteItem["kind"]) =>
    kind === "action" ? "アクション" : kind === "project" ? "プロジェクト" : "タスク";

  return (
    // 背景クリックで閉じる（マウス操作の補助）。Escキーでキーボードからも閉じられる
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        className="animate-fadeIn"
        style={{
          width: "min(560px, calc(100vw - 32px))",
          background: "var(--color-bg-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
          border: "1px solid var(--color-border-primary)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          maxHeight: "min(480px, 70vh)",
        }}
      >
        {/* 検索入力 */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--color-border-primary)" }}>
          <span style={{ fontSize: "14px", flexShrink: 0, opacity: 0.6 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="タスク・プロジェクトを検索、またはアクションを選択..."
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: "14px", color: "var(--color-text-primary)",
            }}
          />
          <kbd style={{
            flexShrink: 0, fontSize: "10px", color: "var(--color-text-tertiary)",
            border: "1px solid var(--color-border-primary)", borderRadius: "4px",
            padding: "2px 6px", background: "var(--color-bg-secondary)",
          }}>Esc</kbd>
        </div>

        {/* 結果リスト */}
        <div ref={listRef} style={{ overflowY: "auto", padding: "6px 0" }}>
          {items.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              「{query}」に一致するものが見つかりません
            </div>
          )}
          {items.map((item, i) => {
            const isFirst = i === 0 || items[i - 1].kind !== item.kind;
            const isSelected = i === selectedIndex;
            return (
              <div key={`${item.kind}_${item.id}`}>
                {isFirst && (
                  <div style={{
                    padding: "8px 16px 4px", fontSize: "10px", fontWeight: 600,
                    color: "var(--color-text-tertiary)", letterSpacing: "0.05em",
                  }}>
                    {groupLabel(item.kind)}
                  </div>
                )}
                {/* マウスでもキーボード（input側のonKeyDown）でも操作可能 */}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
                <div
                  data-index={i}
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "8px 16px", cursor: "pointer",
                    background: isSelected ? "var(--color-bg-secondary)" : "transparent",
                    borderLeft: isSelected ? "3px solid var(--color-brand)" : "3px solid transparent",
                  }}
                >
                  {item.kind === "action" && (
                    <span style={{ fontSize: "14px", flexShrink: 0, width: 20, textAlign: "center" }}>{item.icon}</span>
                  )}
                  {item.kind === "project" && (
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0, marginLeft: 5, marginRight: 5 }} />
                  )}
                  {item.kind === "task" && (
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginLeft: 6, marginRight: 6,
                      background: TASK_STATUS_STYLE[item.task.status].color,
                    }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "13px", color: "var(--color-text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textDecoration: item.kind === "task" && item.task.status === "done" ? "line-through" : "none",
                      opacity: item.kind === "task" && item.task.status === "done" ? 0.6 : 1,
                    }}>
                      {item.label}
                    </div>
                    {item.kind === "task" && item.sub && (
                      <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.sub}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <kbd style={{
                      flexShrink: 0, fontSize: "9px", color: "var(--color-text-tertiary)",
                      border: "1px solid var(--color-border-primary)", borderRadius: "3px",
                      padding: "1px 5px", background: "var(--color-bg-primary)",
                    }}>Enter</kbd>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* フッター：操作ヒント */}
        <div style={{
          padding: "8px 16px", borderTop: "1px solid var(--color-border-primary)",
          display: "flex", gap: "14px", fontSize: "10px", color: "var(--color-text-tertiary)",
          background: "var(--color-bg-secondary)",
        }}>
          <span>↑↓ 移動</span>
          <span>Enter 開く</span>
          <span>Esc 閉じる</span>
        </div>
      </div>
    </div>
  );
}
