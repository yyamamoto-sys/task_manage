// src/components/gantt/GanttParts.tsx
// ガントビューで使う小コンポーネント群

import { memo } from "react";
import type { Task, Member, Project } from "../../lib/localData/types";
import { getAssigneeIds, TASK_STATUS_STYLE } from "../../lib/taskMeta";
import { InlineEditAssignee } from "../common/InlineEditAssignee";
import type { LinkSide } from "../../lib/dependencies/linkDirection";
import { CRITICAL_COLOR } from "./ganttUtils";

// ===== TaskBarLinkUi（B5：ドラッグ結線のハンドル用プロップ束） =====
//
// 【設計意図】ドラッグ結線に関わる値をまとめて1つの任意プロップに束ねる（ghostBar と同じ流儀）。
// フラットプロップを増やしすぎず、かつ memo の比較は各フィールドを直接比較することで
// 意図しない再レンダリングを避ける。
export interface TaskBarLinkUi {
  /** 🔗依存トグルON かつ 非プレビュー のときだけ true。false ならハンドルを一切描画しない */
  enabled: boolean;
  /** このバーがドラッグ元のとき、どちら側のハンドルからか（ドラッグ中でなければ null） */
  sourceSide: LinkSide | null;
  /** ドラッグ中、このバーが現在のドロップ候補かどうか */
  isTarget: boolean;
  /** isTarget のとき、対象になっている具体的な側（null＝バー本体への漠然としたドロップ候補） */
  targetSide: LinkSide | null;
  /** isTarget のときのみ意味を持つ。追加可否の判定結果（null＝未判定） */
  isValid: boolean | null;
  onHandleDown: (e: React.MouseEvent, taskId: string, side: LinkSide) => void;
}

// ===== TaskBarRow =====
//
// 【設計意図】React.memo 化。GanttView は hoveredTaskId 等の状態が親コンポーネントに
// あるため、1本のバーへのマウスオーバーだけで画面全体のバーが再レンダリングされていた
// （カクつきの主因）。ここを memo 化し、コールバックは親側で useCallback により参照を
// 固定してもらうことで、実際に変化した行だけが再レンダリングされるようにする。
// ただし bar は毎レンダー calcTaskBar() が新しいオブジェクトを返すため、デフォルトの
// 浅い比較では常に「変化した」と判定されてしまう → barX/barWidth の値で比較するカスタム
// comparator を使う。

export interface TaskBarRowProps {
  taskId: string;
  bar: { barX: number; barWidth: number } | null;
  barColor: string;
  barHeight?: number;
  borderRadius?: string;
  isDone: boolean;
  isStagnant: boolean;
  isChanged?: boolean;
  isHovered: boolean;
  isPreview: boolean;
  dateLabel: string;
  tooltip: string;
  /** B2：依存の相手（先行）が画面外のとき表示するバッジのツールチップ文言。undefined なら非表示 */
  depBadgeLeftTitle?: string;
  /** B2：依存の相手（後続）が画面外のとき表示するバッジのツールチップ文言。undefined なら非表示 */
  depBadgeRightTitle?: string;
  /** B4：ベースライン（当初計画）の座標。null/undefined なら描かない。bar と同一位置なら描画側で渡さない運用 */
  ghostBar?: { barX: number; barWidth: number } | null;
  /** B4：遅延/前倒しラベル（例："遅延3日"）。null/undefined なら非表示 */
  delayLabel?: string | null;
  /** B4：delayLabel が遅延（正）か前倒し（負）か。色分けに使う */
  isDelayed?: boolean;
  /** B5：ドラッグして依存を結線するハンドル関連。undefined なら機能自体を描画しない */
  linkUi?: TaskBarLinkUi;
  /** バー中央ドラッグでこのバーが今まさに移動中かどうか（grab/grabbingカーソルの切替に使う） */
  isMoving?: boolean;
  /** 複数選択（Ctrl/Cmd+クリック）で選択中かどうか。選択中の全バーは一括ドラッグの対象になる */
  isSelected?: boolean;
  /** B6：クリティカルパス上のタスクかどうか（🎯トグルON時のみ渡される想定）。専用のアクセント
      （太い赤枠）で強調する。isOverdueの塗り色・isStagnantの細い枠とは独立した別レイヤーで
      表現し、既存の「期限超過の赤」やホバー強調と混同しないようにする */
  isCritical?: boolean;
  /** 進捗フィル（0〜1）。バー内の左からこの割合だけ暗いオーバーレイを重ねて塗る（taskHierarchy.ts
      の taskProgressFraction／buildProgressFractionMap で算出：親=子からのロールアップ、
      葉=ステータス由来の慣例値）。undefined/0 は描画しない（既存のバー表現を一切変えない） */
  progressFraction?: number;
  /** クリック（Ctrl/Cmd 押下時は選択トグル、それ以外は詳細を開く＋選択クリア）。
      Enter/Space によるキーボード操作も同じハンドラを通す */
  onEdit: (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>, taskId: string) => void;
  /** 右端ドラッグ：期日変更 */
  onResize: (e: React.MouseEvent<HTMLDivElement>, taskId: string) => void;
  /** 左端ドラッグ：開始日変更（右端と対称）。isDone のときは非表示にする点も右端と同じ */
  onResizeStart: (e: React.MouseEvent<HTMLDivElement>, taskId: string) => void;
  /** バー中央（端のリサイズハンドル・外側の結線ハンドルのどちらでもない領域）ドラッグ：タスク全体の移動。
      選択中（isSelected）かつ選択が2件以上なら選択中の全タスクが一緒に動く。isDone のときは無効
      （リサイズハンドルと同じ扱い） */
  onMoveStart: (e: React.MouseEvent<HTMLDivElement>, taskId: string) => void;
  onMouseEnter: (taskId: string) => void;
  onMouseLeave: () => void;
}

function TaskBarRowImpl({
  taskId, bar, barColor, barHeight = 18, borderRadius = "9px",
  isDone, isStagnant, isChanged = false,
  isHovered, isPreview,
  dateLabel, tooltip, depBadgeLeftTitle, depBadgeRightTitle,
  ghostBar, delayLabel, isDelayed = false, linkUi, isMoving = false, isSelected = false,
  isCritical = false, progressFraction,
  onEdit, onResize, onResizeStart, onMoveStart, onMouseEnter, onMouseLeave,
}: TaskBarRowProps) {
  // 進捗フィル：0〜1にクランプ。0以下（未着手）は何も描画しない＝既存のバー表現を一切変えない
  const clampedProgress = progressFraction == null ? 0 : Math.max(0, Math.min(1, progressFraction));
  // ハンドルを出すかどうか：トグルONの上で「今ホバー中」「自分がドラッグ元」「自分が今のドロップ候補」のいずれか
  const showLinkHandles = !isPreview && !!linkUi?.enabled
    && (isHovered || linkUi.sourceSide != null || linkUi.isTarget);
  const rightEdge = Math.max(
    bar ? bar.barX + bar.barWidth : -Infinity,
    ghostBar ? ghostBar.barX + ghostBar.barWidth : -Infinity,
  );
  // B6：クリティカルパスの外側ハロー（box-shadow）。isSelected/isChanged/isStagnantのoutlineが
  // 何色を取っていても、この赤いハローだけは独立して常に見える（優先順位の奪い合いにしない＝
  // 「選択中かつクリティカル」でも両方の情報が視覚的に共存する設計）
  const criticalShadow = isCritical && !isPreview ? `0 0 0 4px ${CRITICAL_COLOR}4d` : null;
  const linkTargetShadow = linkUi?.isTarget && linkUi.targetSide === null
    ? `0 0 0 2px ${linkUi.isValid === false ? "var(--color-text-danger)" : "var(--color-brand)"}`
    : null;
  return (
    // ホバーによる背景ハイライトのみ（クリック操作は内側のバー要素が担う）
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onMouseEnter={() => onMouseEnter(taskId)}
      onMouseLeave={onMouseLeave}
      style={{
        height: 30, position: "relative",
        borderBottom: "1px solid var(--color-border-primary)",
        background: isChanged
          ? "rgba(127,119,221,0.06)"
          : isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
        transition: "background 0.1s",
      }}
    >
      {/* B4：ベースライン（当初計画）のゴーストバー。実バーより下の層（zIndex 1）に描く */}
      {ghostBar && (
        <div
          title="当初計画（ベースライン）"
          style={{
            position: "absolute",
            left: ghostBar.barX, top: "50%", transform: "translateY(-50%)",
            width: ghostBar.barWidth, height: barHeight,
            borderRadius,
            background: "transparent",
            border: "1.5px dashed var(--color-text-tertiary)",
            opacity: 0.55,
            zIndex: 1,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      )}
      {bar && (
        <>
          <div
            title={tooltip}
            data-task-id={taskId}
            onClick={isPreview ? undefined : e => onEdit(e, taskId)}
            // バー中央（左右端のリサイズハンドル・外側の結線ハンドルに覆われていない領域）へのmousedownは
            // このバー本体自身が受け取る（ハンドルはより高いzIndexで上に乗っているため自然にヒットテストで
            // 除外される）。移動閾値未満ならクリックとして扱われ通常どおり onClick が発火する（GanttView側で
            // 判定・onClick を抑制する仕組みを持つ）
            onMouseDown={isPreview || isDone ? undefined : e => onMoveStart(e, taskId)}
            role={isPreview ? undefined : "button"}
            tabIndex={isPreview ? undefined : 0}
            onKeyDown={isPreview ? undefined : (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(e, taskId); } })}
            style={{
              position: "absolute",
              left: bar.barX, top: "50%", transform: "translateY(-50%)",
              width: bar.barWidth, height: barHeight,
              borderRadius,
              background: barColor,
              opacity: isDone ? 0.5 : 1,
              cursor: isPreview ? "default" : isDone ? "pointer" : isMoving ? "grabbing" : "grab",
              zIndex: 2,
              outline: isSelected
                ? "2px solid var(--color-text-info)"
                : isChanged
                ? "2px solid var(--color-brand)"
                : isCritical
                ? `2.5px solid ${CRITICAL_COLOR}`
                : isStagnant && !isDone ? "1.5px solid #f97316" : "none",
              outlineOffset: "1px",
              overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              filter: isHovered && !isPreview ? "brightness(1.15)" : "none",
              transition: "filter 0.1s",
              // B5：結線ドラッグ中のドロップ候補リング（linkTargetShadow）と、B6：クリティカルパスの
              // 外側ハロー（criticalShadow）は互いに独立したレイヤーなので両方同時に出しうる（カンマ結合）
              boxShadow: [linkTargetShadow, criticalShadow].filter(Boolean).join(", ") || undefined,
            }}
          >
            {/* 進捗フィル：左からclampedProgressの割合だけ暗いオーバーレイを重ねる（塗り色そのものは
                変えず、常にbarColorの上に半透明の黒を重ねる方式＝どのbarColorでも「地の色より少し濃い」
                シェードになる。孤立した右端に薄い縦線を添えて未着手部分との境界を分かりやすくする） */}
            {clampedProgress > 0 && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${clampedProgress * 100}%`,
                  background: "rgba(0,0,0,0.24)",
                  borderRight: clampedProgress < 1 ? "1px solid rgba(255,255,255,0.4)" : "none",
                  pointerEvents: "none",
                }}
              />
            )}
            {bar.barWidth > 52 && (
              <span style={{
                fontSize: "8px", color: "rgba(255,255,255,0.9)", fontWeight: "500",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                padding: "0 4px", pointerEvents: "none",
              }}>{dateLabel}</span>
            )}
          </div>
          {isStagnant && !isDone && !isPreview && (
            <div style={{
              position: "absolute", left: bar.barX + 2, top: "50%", transform: "translateY(-50%)",
              fontSize: "9px", zIndex: 5, pointerEvents: "none", lineHeight: 1,
            }}>⚠</div>
          )}
          {/* B2：依存の相手が画面外（フィルタ除外・別グループ・折りたたみで非表示）のときのバッジ。
              先行が画面外＝バーの左側、後続が画面外＝バーの右側に出す */}
          {depBadgeLeftTitle && (
            <div
              title={depBadgeLeftTitle}
              style={{
                position: "absolute", left: bar.barX - 3, top: "50%", transform: "translate(-100%, -50%)",
                fontSize: "9px", zIndex: 6, lineHeight: 1, cursor: "default",
                background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-full)", padding: "1px 3px",
              }}
            >⏱</div>
          )}
          {depBadgeRightTitle && (
            <div
              title={depBadgeRightTitle}
              style={{
                position: "absolute", left: bar.barX + bar.barWidth + 3, top: "50%", transform: "translateY(-50%)",
                fontSize: "9px", zIndex: 6, lineHeight: 1, cursor: "default",
                background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-full)", padding: "1px 3px",
              }}
            >⏱</div>
          )}
          {!isPreview && !isDone && (
            // 左端ドラッグによる開始日変更専用のハンドル（右端と対称）。バーの端そのもの（±4px）に
            // 重ねて配置＝結線ハンドル（端の外側±9px、B5）とは位置で明確に区別される。
            // マウスのドラッグ操作専用でキーボード代替手段はない
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              onMouseDown={e => onResizeStart(e, taskId)}
              title="ドラッグして開始日を変更"
              style={{
                position: "absolute",
                left: bar.barX - 4,
                top: "50%", transform: "translateY(-50%)",
                width: 8, height: 22, cursor: "ew-resize", zIndex: 3,
              }}
            />
          )}
          {!isPreview && !isDone && (
            // 右端ドラッグによる期日変更専用のハンドル。マウスのドラッグ操作専用でキーボード代替手段はない
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              onMouseDown={e => onResize(e, taskId)}
              title="ドラッグして期日を変更"
              style={{
                position: "absolute",
                left: bar.barX + bar.barWidth - 4,
                top: "50%", transform: "translateY(-50%)",
                width: 8, height: 22, cursor: "ew-resize", zIndex: 3,
              }}
            />
          )}
          {/* B5：依存を結線するハンドル（開始＝左／期日＝右）。バーの端より外側（±9px）に浮かせて
              左右のリサイズハンドルのヒット領域（左：barX-4〜+4／右：barX+barWidth-4〜+4）と
              重ならないようにする。🔗依存トグルON＋ホバー中（or 自分がドラッグ元／ドロップ候補）のときだけ描画 */}
          {showLinkHandles && linkUi && (["start", "due"] as const).map(side => {
            const isSourceHere = linkUi.sourceSide === side;
            const isTargetHere = linkUi.isTarget && linkUi.targetSide === side;
            const x = side === "start" ? bar.barX - 9 : bar.barX + bar.barWidth + 9;
            const ringColor = isTargetHere
              ? (linkUi.isValid === false ? "var(--color-text-danger)" : "var(--color-brand)")
              : isSourceHere ? "var(--color-brand)" : "var(--color-text-tertiary)";
            return (
              // マウスのドラッグ操作専用でキーボード代替手段はない（既存の右端リサイズハンドルと同じ扱い）
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                key={side}
                data-link-handle-task-id={taskId}
                data-link-handle-side={side}
                title={side === "start" ? "開始：ドラッグして先行タスクと接続" : "期日：ドラッグして後続タスクと接続"}
                onMouseDown={e => linkUi.onHandleDown(e, taskId, side)}
                style={{
                  position: "absolute",
                  left: x, top: "50%",
                  transform: (isSourceHere || isTargetHere) ? "translate(-50%, -50%) scale(1.3)" : "translate(-50%, -50%)",
                  width: 9, height: 9, borderRadius: "50%",
                  background: isSourceHere ? "var(--color-brand)" : "var(--color-bg-primary)",
                  border: `1.5px solid ${ringColor}`,
                  boxShadow: "var(--shadow-sm)",
                  cursor: "crosshair", zIndex: 9,
                  transition: "transform 0.1s",
                }}
              />
            );
          })}
        </>
      )}
      {/* B4：遅延/前倒しラベル。バー・ゴーストバーどちらか右端の外側に小さく表示 */}
      {delayLabel && rightEdge > -Infinity && (
        <div
          style={{
            position: "absolute",
            left: rightEdge + (depBadgeRightTitle ? 18 : 3),
            top: "50%", transform: "translateY(-50%)",
            fontSize: "9px", zIndex: 4, lineHeight: 1, whiteSpace: "nowrap",
            pointerEvents: "none", fontWeight: isDelayed ? 600 : 400,
            color: isDelayed ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
          }}
        >{delayLabel}</div>
      )}
    </div>
  );
}

function barRowPropsEqual(prev: TaskBarRowProps, next: TaskBarRowProps): boolean {
  return (
    prev.taskId === next.taskId &&
    (prev.bar?.barX ?? null) === (next.bar?.barX ?? null) &&
    (prev.bar?.barWidth ?? null) === (next.bar?.barWidth ?? null) &&
    prev.barColor === next.barColor &&
    prev.barHeight === next.barHeight &&
    prev.borderRadius === next.borderRadius &&
    prev.isDone === next.isDone &&
    prev.isStagnant === next.isStagnant &&
    prev.isChanged === next.isChanged &&
    prev.isHovered === next.isHovered &&
    prev.isPreview === next.isPreview &&
    prev.dateLabel === next.dateLabel &&
    prev.tooltip === next.tooltip &&
    prev.depBadgeLeftTitle === next.depBadgeLeftTitle &&
    prev.depBadgeRightTitle === next.depBadgeRightTitle &&
    (prev.ghostBar?.barX ?? null) === (next.ghostBar?.barX ?? null) &&
    (prev.ghostBar?.barWidth ?? null) === (next.ghostBar?.barWidth ?? null) &&
    prev.delayLabel === next.delayLabel &&
    prev.isDelayed === next.isDelayed &&
    (prev.linkUi?.enabled ?? false) === (next.linkUi?.enabled ?? false) &&
    (prev.linkUi?.sourceSide ?? null) === (next.linkUi?.sourceSide ?? null) &&
    (prev.linkUi?.isTarget ?? false) === (next.linkUi?.isTarget ?? false) &&
    (prev.linkUi?.targetSide ?? null) === (next.linkUi?.targetSide ?? null) &&
    (prev.linkUi?.isValid ?? null) === (next.linkUi?.isValid ?? null) &&
    (prev.linkUi?.onHandleDown ?? null) === (next.linkUi?.onHandleDown ?? null) &&
    (prev.isMoving ?? false) === (next.isMoving ?? false) &&
    (prev.isSelected ?? false) === (next.isSelected ?? false) &&
    (prev.isCritical ?? false) === (next.isCritical ?? false) &&
    (prev.progressFraction ?? 0) === (next.progressFraction ?? 0) &&
    prev.onEdit === next.onEdit &&
    prev.onResize === next.onResize &&
    prev.onResizeStart === next.onResizeStart &&
    prev.onMoveStart === next.onMoveStart &&
    prev.onMouseEnter === next.onMouseEnter &&
    prev.onMouseLeave === next.onMouseLeave
  );
}

export const TaskBarRow = memo(TaskBarRowImpl, barRowPropsEqual);

// ===== GanttPjLabelRow（PJ別ビュー・ラベル列のタスク行） =====

export interface GanttPjLabelRowProps {
  task: Task;
  isChild: boolean;
  childCount: number;
  isHovered: boolean;
  isCollapsed: boolean;
  members: Member[];
  onEdit: (taskId: string) => void;
  onHoverEnter: (taskId: string) => void;
  onHoverLeave: () => void;
  onToggleCollapse: (taskId: string) => void;
  onSaveAssignees: (task: Task, ids: string[]) => void;
}

export const GanttPjLabelRow = memo(function GanttPjLabelRow({
  task, isChild, childCount, isHovered, isCollapsed, members,
  onEdit, onHoverEnter, onHoverLeave, onToggleCollapse, onSaveAssignees,
}: GanttPjLabelRowProps) {
  return (
    <div key={task.id} onClick={() => onEdit(task.id)}
      onMouseEnter={() => onHoverEnter(task.id)}
      onMouseLeave={onHoverLeave}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onEdit(task.id); }}
      style={{
      height: 30, display: "flex", alignItems: "center",
      gap: "5px", padding: isChild ? "0 8px 0 40px" : "0 8px 0 10px",
      borderBottom: "1px solid var(--color-border-primary)",
      borderTop: (!isChild && childCount > 0) ? "2px solid var(--color-border-primary)" : undefined,
      background: isHovered
        ? "var(--color-bg-secondary)"
        : isChild ? "var(--color-bg-primary)"
        : childCount > 0 ? "var(--color-bg-secondary)"
        : "var(--color-bg-primary)",
      boxShadow: !isChild && childCount > 0
        ? "inset 3px 0 0 var(--color-brand)"
        : isChild
        ? "inset 2px 0 0 var(--color-brand-border)"
        : "none",
      cursor: "pointer", transition: "background 0.1s",
    }}>
      {isChild ? (
        <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0, marginLeft: "-10px" }}>↳</span>
      ) : childCount > 0 ? (
        <span
          onClick={e => { e.stopPropagation(); onToggleCollapse(task.id); }}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onToggleCollapse(task.id); } }}
          aria-label={isCollapsed ? "子タスクを表示" : "子タスクを隠す"}
          aria-expanded={!isCollapsed}
          style={{
            fontSize: "11px", color: "var(--color-text-secondary)",
            transition: "transform 0.15s", display: "inline-block",
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
            flexShrink: 0, cursor: "pointer", width: 14, textAlign: "center",
          }}
        >▾</span>
      ) : (
        <span style={{ flexShrink: 0, width: 14 }} />
      )}
      <StatusDot status={task.status} />
      <span style={{
        fontSize: "11px",
        fontWeight: (!isChild && childCount > 0) ? "600" : "400",
        color: isChild ? "var(--color-text-tertiary)" : childCount > 0 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1,
        textDecoration: task.status === "done" || task.status === "cancelled" ? "line-through" : "none",
        opacity: task.status === "done" || task.status === "cancelled" ? 0.6 : 1,
      }}>
        {task.name}
      </span>
      {childCount > 0 && (
        <span style={{
          fontSize: "8px", fontWeight: "600", color: "var(--color-text-purple)",
          background: "var(--color-brand-light)", border: "1px solid var(--color-brand-border)",
          borderRadius: "var(--radius-full)", padding: "0 5px", flexShrink: 0,
        }}>
          子{childCount}
        </span>
      )}
      {/* 行クリックでタスク編集モーダルが開くため、アイコンクリックはそちらに伝播させない（クリックしても何も起きないラッパー） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
        <InlineEditAssignee
          assigneeIds={getAssigneeIds(task)}
          members={members}
          onSave={ids => onSaveAssignees(task, ids)}
        />
      </div>
    </div>
  );
});

// ===== GanttTodoLabelRow（ToDo系グループ・ラベル列のタスク行） =====

export interface GanttTodoLabelRowProps {
  task: Task;
  isHovered: boolean;
  members: Member[];
  onEdit: (taskId: string) => void;
  onHoverEnter: (taskId: string) => void;
  onHoverLeave: () => void;
  onSaveAssignees: (task: Task, ids: string[]) => void;
}

export const GanttTodoLabelRow = memo(function GanttTodoLabelRow({
  task, isHovered, members, onEdit, onHoverEnter, onHoverLeave, onSaveAssignees,
}: GanttTodoLabelRowProps) {
  return (
    <div key={task.id} onClick={() => onEdit(task.id)}
      onMouseEnter={() => onHoverEnter(task.id)}
      onMouseLeave={onHoverLeave}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onEdit(task.id); }}
      style={{
      height: 30, display: "flex", alignItems: "center",
      gap: "6px", padding: "0 8px 0 26px",
      borderBottom: "1px solid var(--color-border-primary)",
      background: isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
      cursor: "pointer", transition: "background 0.1s",
    }}>
      <StatusDot status={task.status} />
      <span style={{
        fontSize: "11px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        textDecoration: task.status === "done" || task.status === "cancelled" ? "line-through" : "none",
        opacity: task.status === "done" || task.status === "cancelled" ? 0.6 : 1,
      }}>
        {task.name}
      </span>
      {/* 行クリックでタスク編集モーダルが開くため、アイコンクリックはそちらに伝播させない（クリックしても何も起きないラッパー） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
        <InlineEditAssignee
          assigneeIds={getAssigneeIds(task)}
          members={members}
          onSave={ids => onSaveAssignees(task, ids)}
        />
      </div>
    </div>
  );
});

// ===== GanttPersonLabelRow（人別ビュー・ラベル列のタスク行） =====

export interface GanttPersonLabelRowProps {
  task: Task;
  isHovered: boolean;
  isOverdue: boolean;
  pj: Project | undefined;
  onEdit: (taskId: string) => void;
  onHoverEnter: (taskId: string) => void;
  onHoverLeave: () => void;
}

export const GanttPersonLabelRow = memo(function GanttPersonLabelRow({
  task, isHovered, isOverdue, pj, onEdit, onHoverEnter, onHoverLeave,
}: GanttPersonLabelRowProps) {
  return (
    <div key={task.id} onClick={() => onEdit(task.id)}
      onMouseEnter={() => onHoverEnter(task.id)}
      onMouseLeave={onHoverLeave}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onEdit(task.id); }}
      style={{
      height: 30, display: "flex", alignItems: "center",
      gap: "5px", padding: "0 8px 0 26px",
      borderBottom: "1px solid var(--color-border-primary)",
      background: isHovered ? "var(--color-bg-secondary)" : "var(--color-bg-primary)",
      cursor: "pointer", transition: "background 0.1s",
    }}>
      <StatusDot status={task.status} />
      {pj && (
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: pj.color_tag, flexShrink: 0,
        }} />
      )}
      <span style={{
        fontSize: "11px",
        color: isOverdue ? "var(--color-text-danger)" : "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1,
        textDecoration: task.status === "done" || task.status === "cancelled" ? "line-through" : "none",
        opacity: task.status === "done" || task.status === "cancelled" ? 0.6 : 1,
      }}>
        {task.parent_task_id ? "↳ " : ""}{task.name}
      </span>
    </div>
  );
});

// ===== StatusDot =====

export function StatusDot({ status }: { status: Task["status"] }) {
  return (
    <div style={{
      width: 6, height: 6, borderRadius: "50%",
      background: TASK_STATUS_STYLE[status].color, flexShrink: 0,
    }} />
  );
}

// ===== ZoomIcon =====

export function ZoomIcon({ minus = false }: { minus?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: "block" }}>
      {/* 虫眼鏡の円 */}
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      {/* ハンドル */}
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* 横棒（共通） */}
      <line x1="3.8" y1="6" x2="8.2" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* 縦棒（＋のみ） */}
      {!minus && <line x1="6" y1="3.8" x2="6" y2="8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}
