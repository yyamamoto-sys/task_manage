// src/components/lab/MyPageView.tsx
//
// 【設計意図】
// ラボ機能「マイページ」のホスト画面。CalendarLabView と全く同じ流儀の全画面オーバーレイ
// （position:fixed inset:0・zIndex 250・animate-overlay＋本体アニメーション・✕で閉じる）。
//
// 【最重要の契約（CLAUDE.md参照）】
// ウィジェットのコンポーネントから useAppStore を直接呼ばせない。部署スコープ済みデータの
// 用意（selectScopedTasks/selectScopedProjects/selectScopedMembers を購読するのはここ1箇所
// だけ）・書き込みの choke point（saveTask 等）を経由させる副作用の提供は、すべてこの
// ホストの責任とする。ウィジェットには WidgetContext だけを渡す。
//
// 未知の widget_id のインスタンス（ウィジェットを廃止・リネームした後もユーザーのレイアウト
// には残る）は「このウィジェットは現在利用できません」のプレースホルダを出す（編集モードで
// 削除可）。normalizeLayout（lib/widgets/layout.ts）が意図的にこれらを捨てないため、ここで
// 描画時にフォールバック表示する。

import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  useAppStore, selectScopedTasks, selectScopedProjects, selectScopedMembers, selectScopedTaskDependencies,
} from "../../stores/appStore";
import type { Member, ViewMode } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { isGuestMember } from "../../lib/guestMode";
import { computeDropZoneFromRatio } from "../../lib/dragReorder";
import type { WidgetContext, WidgetInstance, WidgetSize } from "../../lib/widgets/types";
import { addWidget, removeWidget, moveWidget, setWidgetSize, setWidgetConfig } from "../../lib/widgets/layout";
import { useMyPageLayout } from "../../hooks/useMyPageLayout";
import { WIDGET_REGISTRY, getWidgetDefinition } from "./widgets/registry";
import { WidgetErrorBoundary } from "./widgets/WidgetErrorBoundary";
import { WidgetConfigModal } from "./widgets/WidgetConfigModal";

interface Props {
  onClose: () => void;
  currentUser: Member;
  onOpenTask: (taskId: string) => void;
  /** ビューを切り替える。MyPageView 側でマイページ自体を閉じるところまで面倒を見る */
  onNavigate: (view: ViewMode) => void;
  /**
   * タスクを1件作成する（QuickAddTaskWidget向け）。実装はホスト（MainLayout）側で
   * appStore.saveTask を呼ぶ（choke point迂回防止。lib/widgets/types.ts の
   * WidgetContext.actions.createTask のコメント参照）。
   */
  onCreateTask: (draft: { name: string; projectId?: string | null; dueDate?: string | null }) => Promise<void>;
}

const SIZE_TO_COLS: Record<WidgetSize, number> = { s: 1, m: 2, l: 3 };

function computeTotalCols(width: number): number {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

const HEADER_BTN: React.CSSProperties = {
  padding: "4px 10px", fontSize: "12px", cursor: "pointer",
  background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
};

const ADD_BTN: React.CSSProperties = {
  padding: "4px 10px", fontSize: "12px", cursor: "pointer", fontWeight: 600,
  background: "var(--color-brand)", color: "#fff",
  border: "none", borderRadius: "var(--radius-md)",
};

const ICON_BTN: React.CSSProperties = {
  width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: "12px", cursor: "pointer", flexShrink: 0,
  background: "transparent", border: "none", color: "var(--color-text-tertiary)",
  borderRadius: "var(--radius-sm)",
};

export function MyPageView({ onClose, currentUser, onOpenTask, onNavigate, onCreateTask }: Props) {
  const isGuest = isGuestMember(currentUser);

  const rawTasks = useAppStore(selectScopedTasks);
  const rawProjects = useAppStore(selectScopedProjects);
  const rawMembers = useAppStore(selectScopedMembers);
  const rawTaskDependencies = useAppStore(selectScopedTaskDependencies);
  const tasks = useMemo(() => active(rawTasks), [rawTasks]);
  const projects = useMemo(() => active(rawProjects), [rawProjects]);
  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const taskDependencies = useMemo(() => rawTaskDependencies.filter(d => !d.is_deleted), [rawTaskDependencies]);

  const { layout, setLayout, loading } = useMyPageLayout(currentUser);

  const [editMode, setEditMode] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [configInstanceId, setConfigInstanceId] = useState<string | null>(null);
  const [totalCols, setTotalCols] = useState(() => computeTotalCols(window.innerWidth));

  useEffect(() => {
    const onResize = () => setTotalCols(computeTotalCols(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ドラッグ並べ替え（HTML5 drag events）。ハイライトは box-shadow の inset のみで表現する
  // （border幅の変化はレイアウトを動かしdragover/dragleaveの高頻度往復を招く。CLAUDE.md v2.25）
  // computeDropZoneFromRatio は汎用のDropZone型（"before"|"after"|"nest"）を返すが、
  // allowNest=false で呼ぶ限り "nest" は返らない（ListView/GanttViewと共有する既存の純粋関数の
  // 型をそのまま使い、ここでは常に before/after の2値のみを想定する）
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ instanceId: string; zone: "before" | "after" } | null>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    if (!editMode || !draggingId || draggingId === targetId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    const zone: "before" | "after" = computeDropZoneFromRatio(ratio, false) === "before" ? "before" : "after";
    setDropTarget(prev => (prev?.instanceId === targetId && prev.zone === zone ? prev : { instanceId: targetId, zone }));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    if (!draggingId) return;
    const dragged = draggingId;
    const zone = dropTarget?.zone ?? "after";
    setDraggingId(null);
    setDropTarget(null);
    if (dragged === targetId) return;
    setLayout(prev => {
      const withoutDragged = prev.widgets.filter(w => w.instance_id !== dragged);
      const targetIdx = withoutDragged.findIndex(w => w.instance_id === targetId);
      if (targetIdx < 0) return prev;
      const insertIndex = targetIdx + (zone === "after" ? 1 : 0);
      return moveWidget(prev, dragged, insertIndex);
    });
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleAddWidget = (widgetId: string) => {
    const def = getWidgetDefinition(widgetId);
    if (!def) return;
    setLayout(prev => addWidget(prev, widgetId, def.defaultSize, uuidv4()));
    setIsAddOpen(false);
  };

  const handleNavigate = (view: ViewMode) => {
    onNavigate(view);
    onClose();
  };

  // ウィジェット本体・設定モーダルの両方で同じ WidgetContext を使う（構築ロジックの二重化を避ける）
  const buildContext = (w: WidgetInstance): WidgetContext => ({
    currentUser,
    data: { tasks, projects, members, taskDependencies },
    actions: {
      openTask: onOpenTask,
      navigateTo: handleNavigate,
      createTask: onCreateTask,
    },
    config: w.config,
    setConfig: (next) => setLayout(prev => setWidgetConfig(prev, w.instance_id, next)),
  });

  const renderWidgetInstance = (w: WidgetInstance) => {
    const def = getWidgetDefinition(w.widget_id);
    const spanCols = Math.min(SIZE_TO_COLS[w.size], totalCols);
    const highlight = dropTarget?.instanceId === w.instance_id
      ? dropTarget.zone === "before"
        ? "inset 0 3px 0 0 var(--color-brand)"
        : "inset 0 -3px 0 0 var(--color-brand)"
      : undefined;

    const wrapperStyle: React.CSSProperties = {
      gridColumn: `span ${spanCols}`,
      background: "var(--color-bg-primary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      boxShadow: highlight,
      opacity: draggingId === w.instance_id ? 0.5 : 1,
    };

    const headerStyle: React.CSSProperties = {
      display: "flex", alignItems: "center", gap: "6px",
      padding: "8px 10px", borderBottom: "1px solid var(--color-border-primary)",
      flexShrink: 0,
    };

    if (!def) {
      return (
        // ドラッグ&ドロップの受け皿（onDragOver/onDrop）はキーボード操作を要さない操作
        // （並べ替え自体は⠿ドラッグハンドルからのマウス操作のみ・キーボード代替は無し。
        // 既存のListView/GanttView/KanbanViewの行ドロップと同じ扱い）
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          key={w.instance_id}
          style={wrapperStyle}
          onDragOver={e => handleDragOver(e, w.instance_id)}
          onDrop={e => handleDrop(e, w.instance_id)}
        >
          <div style={headerStyle}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-tertiary)", flex: 1 }}>
              ⚠ 利用できないウィジェット
            </span>
            {editMode && (
              <button
                onClick={() => setLayout(prev => removeWidget(prev, w.instance_id))}
                style={ICON_BTN} aria-label="このウィジェットを削除" title="削除"
              >✕</button>
            )}
          </div>
          <div style={{ padding: "16px 10px", fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center" }}>
            このウィジェットは現在利用できません
          </div>
        </div>
      );
    }

    const context = buildContext(w);

    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        key={w.instance_id}
        style={wrapperStyle}
        draggable={editMode}
        onDragStart={editMode ? () => setDraggingId(w.instance_id) : undefined}
        onDragOver={e => handleDragOver(e, w.instance_id)}
        onDrop={e => handleDrop(e, w.instance_id)}
        onDragEnd={handleDragEnd}
      >
        <div style={headerStyle}>
          {editMode && (
            <span style={{ cursor: "grab", color: "var(--color-text-tertiary)", fontSize: "13px", flexShrink: 0 }} title="ドラッグして並べ替え">⠿</span>
          )}
          <span style={{ fontSize: "13px", flexShrink: 0 }}>{def.icon}</span>
          <span style={{
            fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{def.title}</span>
          {editMode && (
            <>
              <div style={{ display: "flex", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden", flexShrink: 0 }}>
                {(["s", "m", "l"] as WidgetSize[]).map(sz => {
                  const allowed = def.allowedSizes.includes(sz);
                  return (
                    <button
                      key={sz}
                      disabled={!allowed}
                      onClick={() => setLayout(prev => setWidgetSize(prev, w.instance_id, sz))}
                      title={`サイズ：${sz.toUpperCase()}`}
                      style={{
                        padding: "2px 6px", fontSize: "9px", border: "none",
                        cursor: allowed ? "pointer" : "not-allowed",
                        background: w.size === sz ? "var(--color-brand-light)" : "transparent",
                        color: w.size === sz ? "var(--color-text-purple)" : "var(--color-text-tertiary)",
                        opacity: allowed ? 1 : 0.35,
                      }}
                    >{sz.toUpperCase()}</button>
                  );
                })}
              </div>
              {def.configSchema && def.configSchema.length > 0 && (
                <button
                  onClick={() => setConfigInstanceId(w.instance_id)}
                  style={ICON_BTN} aria-label={`${def.title}の設定`} title="設定"
                >⚙</button>
              )}
              <button
                onClick={() => setLayout(prev => removeWidget(prev, w.instance_id))}
                style={ICON_BTN} aria-label={`${def.title}を削除`} title="削除"
              >✕</button>
            </>
          )}
        </div>
        <div style={{ padding: "10px 12px", flex: 1, overflow: "auto" }}>
          <WidgetErrorBoundary title={def.title}>
            <def.render {...context} />
          </WidgetErrorBoundary>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-overlay" style={{
      position: "fixed", inset: 0, zIndex: 250,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 32px",
    }}>
      <div className="animate-fadeIn" style={{
        width: "100%", maxWidth: "1200px",
        height: "100%", maxHeight: "100%",
        background: "var(--color-bg-secondary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* ===== ヘッダー ===== */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
          padding: "12px 18px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0,
          background: "var(--color-bg-primary)",
        }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>🧩 マイページ</span>
          <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)" }}>ラボ</span>

          {!isGuest && (
            <button
              onClick={() => setEditMode(v => !v)}
              title={editMode ? "編集を終了して閲覧モードに戻る" : "並べ替え・追加・削除ができる編集モードに入る"}
              style={{
                ...HEADER_BTN,
                background: editMode ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                color: editMode ? "var(--color-text-purple)" : "var(--color-text-secondary)",
                borderColor: editMode ? "var(--color-brand-border)" : "var(--color-border-primary)",
              }}
            >{editMode ? "✓ 編集を終了" : "✎ 編集"}</button>
          )}
          {editMode && !isGuest && (
            <button onClick={() => setIsAddOpen(true)} style={ADD_BTN}>＋ ウィジェットを追加</button>
          )}

          <div style={{ flex: 1 }} />
          {isGuest && (
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>ゲストは閲覧のみです</span>
          )}
          <button onClick={onClose} title="閉じる" aria-label="閉じる" style={{ ...HEADER_BTN, fontSize: "16px", padding: "2px 10px" }}>×</button>
        </div>

        {/* ===== 本体 ===== */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 18px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "48px 0", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              読み込み中...
            </div>
          ) : layout.widgets.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: "32px", opacity: 0.6, marginBottom: "10px" }}>🧩</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "14px" }}>
                ウィジェットがまだありません
              </div>
              {!isGuest && (
                <button onClick={() => { setEditMode(true); setIsAddOpen(true); }} style={ADD_BTN}>
                  ＋ ウィジェットを追加
                </button>
              )}
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${totalCols}, 1fr)`,
              gap: "12px",
              alignItems: "start",
            }}>
              {layout.widgets.map(w => renderWidgetInstance(w))}
            </div>
          )}
        </div>
      </div>

      {isAddOpen && (
        <AddWidgetModal onAdd={handleAddWidget} onClose={() => setIsAddOpen(false)} />
      )}

      {configInstanceId && (() => {
        const instance = layout.widgets.find(w => w.instance_id === configInstanceId);
        const def = instance ? getWidgetDefinition(instance.widget_id) : undefined;
        if (!instance || !def || !def.configSchema) return null;
        return (
          <WidgetConfigModal
            title={def.title}
            icon={def.icon}
            schema={def.configSchema}
            context={buildContext(instance)}
            onClose={() => setConfigInstanceId(null)}
          />
        );
      })()}
    </div>
  );
}

function AddWidgetModal({ onAdd, onClose }: { onAdd: (widgetId: string) => void; onClose: () => void }) {
  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は✕ボタンでキーボードから可能
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 260,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="panel-slide-up" style={{
        width: "min(480px, 100%)", maxHeight: "80vh",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            ＋ ウィジェットを追加
          </span>
          <button
            onClick={onClose} aria-label="閉じる"
            style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", color: "var(--color-text-tertiary)" }}
          >✕</button>
        </div>
        <div style={{ padding: "12px 18px", overflow: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          {WIDGET_REGISTRY.map(def => (
            <button
              key={def.id}
              onClick={() => onAdd(def.id)}
              style={{
                display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                background: "var(--color-bg-secondary)", cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ fontSize: "18px", flexShrink: 0 }}>{def.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>{def.title}</div>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{def.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
