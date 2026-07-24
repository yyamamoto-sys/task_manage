// src/components/gantt/ganttUtils.ts
// ガントビュー共通の定数・型・純粋関数

import type { Task, Milestone, Project, Member, ToDo } from "../../lib/localData/types";
import { toDate, toDateStr, diffDays, addDays } from "../../lib/date";
import type { OverloadRange } from "../../lib/gantt/overload";
import { computeRangeSelection } from "../../lib/selectionRange";

// computeRangeSelection は src/lib/selectionRange.ts に集約（ListView と共有するため）。
// 既存の呼び出し元（本ファイル内・ganttUtils.test.ts）を壊さないよう再エクスポートする。
export { computeRangeSelection };

export const DAY_WIDTH_DEFAULT = 28;
export const ZOOM_LEVELS = [14, 20, 28, 36, 48] as const;
export const STAGNANT_THRESHOLD_DAYS = 5;
export const TODO_COLOR = "#6ee7b7";
export const MS_COLOR   = "#f59e0b";
export const MS_BORDER  = "#d97706";
/**
 * クリティカルパス専用アクセント色（B6）。既存の期限超過（var(--color-border-danger)＝
 * 淡いくすみ色の"塗り"）やホバー強調（filter:brightness）とは混同しないよう、彩度の高い
 * 単色を"太い枠線"というまったく別の視覚要素として使う（塗りではなく線種で区別できる設計）。
 * ライト/ダークどちらの背景でも視認できるよう固定hex（stagnantの#f97316と同じ流儀）。
 */
export const CRITICAL_COLOR = "#dc2626";
/**
 * 過負荷（オーバーアロケーション）帯の色（人別ビュー専用）。マイルストーン帯（MS_COLOR＝amber）・
 * クリティカルパス（CRITICAL_COLOR＝red）と混同しないよう、警告色として別のオレンジを固定hexで使う
 * （stagnantの#f97316と同系統・同じ流儀）。
 */
export const OVERLOAD_COLOR = "#f97316";

// ===== ヘッダー高さ（左ラベル列・右バー列で必ず一致させる。CLAUDE.md v3.06） =====
//
// 【設計意図】左ラベル列（labelBodyRef）と右バー列（scrollRef）は別スクロールコンテナで
// scrollTopを同期しているだけなので、両列のヘッダー高さが1pxでもずれると全行が同じ量だけ
// 縦にずれる（v3.05で右列だけにものさし目盛り16pxを足したのが実例のリグレッション）。
// 右列は月ラベル・週ラベル・ものさし目盛りの3段に分かれているため個別定数を残しつつ、
// 左ラベル列のヘッダーはこの合計値を直接使うことで、今後どちらかの段を変更しても
// 両列が自動的に一致し続けるようにする。
export const GANTT_HEADER_MONTH_HEIGHT = 24;
export const GANTT_HEADER_WEEK_HEIGHT = 28;
export const GANTT_HEADER_DAY_TICK_HEIGHT = 16;
export const GANTT_LABEL_HEADER_HEIGHT = GANTT_HEADER_MONTH_HEIGHT + GANTT_HEADER_WEEK_HEIGHT + GANTT_HEADER_DAY_TICK_HEIGHT;

/**
 * PJ別ビュー・ラベル列末尾の簡易タスク追加行（GanttQuickAddTaskRow）の高さ。
 * 右バー列側は対応するタスク行が無い（バーを持たない見出し専用行のため）ので、
 * GanttViewが同じ値の空スペーサーをPJブロック末尾に描画して左右のPJブロック高さを一致させる
 * （CLAUDE.md v3.06。v3.04でこの行を追加した際に右列側のスペーサーが漏れていた累積ズレの修正）。
 */
export const QUICK_ADD_ROW_HEIGHT = 26;

export type GanttSortOrder = "date" | "name";

export function isTaskStagnant(task: Task, now = Date.now()): boolean {
  if (task.status !== "in_progress" || !task.updated_at) return false;
  const diffMs = now - new Date(task.updated_at).getTime();
  return diffMs / (1000 * 60 * 60 * 24) >= STAGNANT_THRESHOLD_DAYS;
}

export function calcTaskBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  const due = toDate(task.due_date);
  if (!due) return null;
  const start = toDate(task.start_date ?? null);
  if (start && start <= due) {
    const barX = diffDays(rangeStart, start) * dayWidth;
    const barWidth = Math.max((diffDays(start, due) + 1) * dayWidth - 4, dayWidth - 4);
    return { barX, barWidth };
  }
  return { barX: diffDays(rangeStart, due) * dayWidth, barWidth: dayWidth - 4 };
}

// ===== B4：ベースライン（当初計画）差分 =====

/**
 * タスクのベースライン（baseline_start_date/baseline_due_date）の位置を計算する。
 * calcTaskBar を「ベースライン日付を差し込んだ仮タスク」で呼ぶだけ（座標計算ロジックの二重化を避ける）。
 * ベースライン未凍結（片方または両方 null）なら null。
 */
export function calcGhostBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  if (!task.baseline_start_date || !task.baseline_due_date) return null;
  return calcTaskBar({ ...task, start_date: task.baseline_start_date, due_date: task.baseline_due_date }, rangeStart, dayWidth);
}

/**
 * 現在の期日 − 当初計画（baseline）の期日（暦日）。正=遅延、負=前倒し。
 * ベースライン未凍結、または現在の期日が未設定なら null。
 */
export function computeDelayDays(task: Task): number | null {
  if (!task.baseline_due_date || !task.due_date) return null;
  return diffDays(task.baseline_due_date, task.due_date);
}

/** 遅延日数 → 表示ラベル。0（差分なし）は非表示（null）。 */
export function formatDelayLabel(delayDays: number | null): string | null {
  if (delayDays === null || delayDays === 0) return null;
  return delayDays > 0 ? `遅延${delayDays}日` : `${Math.abs(delayDays)}日前倒し`;
}

// ===== ヘッダー週ラベル（カレンダー週＝月曜始まり・日曜終わり方式。CLAUDE.md v3.09） =====
//
// 【設計方針】週はカレンダー表示と同じ「月曜〜日曜」で整列させる（山本さん確定・v2.38の
// 「月内日数ブロック」から変更）。W1＝その月の1日〜その月で最初の日曜（月頭の半端な週。
// 1日が日曜ならその日だけ）。W2以降は月曜始まり・日曜終わりの7日間。週番号は月ごとにリセット
// （月が変わったら常にW1から数え直す）。結果としてブロックの区切りは「毎週月曜(getDay()===1)」
// と「月の1日(getDate()===1)」に入り、月をまたぐカレンダー週は月境界で切れる
// （days は getDaysInRange の連続日付配列前提）。
export interface WeekBlock {
  /** 例："8月W1" */
  label: string;
  startX: number;
  width: number;
  /** そのブロックが月の最初の日（1日）から始まる＝月の境界。ヘッダーの区切り線の強調に使う */
  isMonthStart: boolean;
  /** ブロック内の最初の日（ツールチップ表示用） */
  startDate: Date;
  /** ブロック内の最後の日（ツールチップ表示用） */
  endDate: Date;
}

/**
 * 日付 → その月内でのカレンダー週番号（1始まり・月曜始まり週で数える）。
 * 月の1日の曜日から「月頭の半端な週（W1）の長さ」を求め（1日が日曜なら1日、それ以外は
 * 次の日曜までの日数）、以降は7日ずつのMon-Sun週として数える。days配列がどの日から
 * 始まっていても（月の途中スタートでも）その日単体から正しい週番号を求められる純粋関数。
 */
function calendarWeekNumber(d: Date): number {
  const day = d.getDate();
  const firstDow = new Date(d.getFullYear(), d.getMonth(), 1).getDay(); // 0=日〜6=土
  const firstWeekLen = firstDow === 0 ? 1 : 8 - firstDow;
  if (day <= firstWeekLen) return 1;
  return 2 + Math.floor((day - firstWeekLen - 1) / 7);
}

export function computeWeekBlocks(days: Date[], dayWidth: number): WeekBlock[] {
  const blocks: WeekBlock[] = [];
  let i = 0;
  while (i < days.length) {
    const d = days[i];
    const month = d.getMonth();
    const year = d.getFullYear();
    let j = i + 1;
    while (j < days.length) {
      const dj = days[j];
      if (dj.getFullYear() !== year || dj.getMonth() !== month) break; // 月境界
      if (dj.getDay() === 1) break; // 月曜境界
      j++;
    }
    blocks.push({
      label: `${month + 1}月W${calendarWeekNumber(d)}`,
      startX: i * dayWidth,
      width: (j - i) * dayWidth,
      isMonthStart: d.getDate() === 1,
      startDate: days[i],
      endDate: days[j - 1],
    });
    i = j;
  }
  return blocks;
}

/**
 * 週コラム境界（週ブロックの開始x座標）の一覧。月初（W1＝月の境界）は borderDays 側の
 * 太い境界線が既に引かれているため対象外にする（同じ位置に二重線を描かない）。
 * 淡い列グリッドはこの関数が返す x 座標にだけ描く。
 */
export function computeWeekGridLines(weekBlocks: WeekBlock[]): number[] {
  return weekBlocks.filter(wb => !wb.isMonthStart).map(wb => wb.startX);
}

// ===== ものさし目盛り行（週ラベルの直下・1日ごとの目盛り。CLAUDE.md v3.05） =====

export type DayTickColorKind = "holiday" | "sunday" | "saturday" | "weekday";

/** 目盛り線・数字の色（赤=日曜/祝日、青=土曜）。祝日・critical path 等の他の赤系配色とは
 * 用途が異なる（ヘッダー行専用）ため、専用の定数として分ける。 */
export const HOLIDAY_TICK_COLOR = "#dc2626";
export const SATURDAY_TICK_COLOR = "#2563eb";

/**
 * 曜日＋祝日名 → 目盛りの色分類。優先順位は 祝日 > 日曜 > 土曜 > 平日（祝日が日曜と重なる
 * ケースでも祝日側を優先するが、どちらも赤なので見た目上は同じ）。
 */
export function dayTickColorKind(date: Date, holidayName: string | null): DayTickColorKind {
  if (holidayName) return "holiday";
  const dow = date.getDay();
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}

/** colorKind → 実際に描画する色（CSS color値）。平日はテーマの控えめなトークンを使う。 */
export function dayTickColor(colorKind: DayTickColorKind): string {
  switch (colorKind) {
    case "holiday":
    case "sunday":
      return HOLIDAY_TICK_COLOR;
    case "saturday":
      return SATURDAY_TICK_COLOR;
    default:
      return "var(--color-text-tertiary)";
  }
}

export interface DayTick {
  x: number;
  /** 日のみ（1〜31）。月は上の月ラベル行で分かるため日だけ表示する */
  day: number;
  colorKind: DayTickColorKind;
  /** 祝日名（ホバーツールチップ用）。祝日でなければ null */
  holidayName: string | null;
}

/**
 * ものさし目盛り行（1日ごと）の描画データを計算する純粋関数。days配列1件につき1目盛り
 * （x座標・日の数字・色分類・祝日名）を返す。GanttView側はこれをuseMemoで回し、
 * days/dayWidthが変わらない限り再計算しない（365日規模でも計算コストは1回のmapのみ）。
 *
 * isHolidayFn は呼び出し側（GanttView.tsx）から lib/date/holidays の isHoliday を渡す。
 * ganttUtils.ts はどのビューからも（appStore.ts の computeBulkMoveShifts 経由も含め）
 * 参照される共有モジュールのため、祝日ライブラリ（CJSでtree-shakeされにくい）への
 * import をここに書くと appStore 側の即時読み込みバンドルにも祝日ライブラリが混入して
 * しまう。関数として注入することでガントビューの遅延読み込みチャンクだけに閉じ込める。
 */
export function computeDayTicks(days: Date[], dayWidth: number, isHolidayFn: (dateStr: string) => string | null): DayTick[] {
  return days.map((d, i) => {
    const holidayName = isHolidayFn(toDateStr(d));
    return {
      x: i * dayWidth,
      day: d.getDate(),
      colorKind: dayTickColorKind(d, holidayName),
      holidayName,
    };
  });
}

// ===== マイルストーン帯（PJ内・スクロールしても埋もれないようにする視認補助） =====

/**
 * マイルストーンの帯色を1箇所から取得する。現状は全マイルストーン共通の MS_COLOR だが、
 * 将来マイルストーンごとに個別色を持つようになったら、ここだけ変更すれば帯・◆印の色が揃う。
 */
export function getMilestoneBandColor(_ms: Milestone): string {
  return MS_COLOR;
}

export interface MilestoneBand {
  x: number;
  color: string;
}

/**
 * 同じPJ内のマイルストーンから、帯を描く対象日の x 座標一覧を計算する（純粋関数）。
 * 同一日に複数マイルストーンがあっても帯は1本だけ描く（重ねて濃くなりすぎるのを防ぐため、
 * 日付で重複除去する。色は最初に見つかった1件の色を採用する）。
 */
export function computeMilestoneBands(pjMilestones: Milestone[], rangeStart: Date, dayWidth: number): MilestoneBand[] {
  const seen = new Map<string, MilestoneBand>();
  for (const ms of pjMilestones) {
    const d = toDate(ms.date);
    if (!d) continue;
    const key = toDateStr(d);
    if (seen.has(key)) continue;
    seen.set(key, { x: diffDays(rangeStart, d) * dayWidth, color: getMilestoneBandColor(ms) });
  }
  return [...seen.values()];
}

// ===== 過負荷（オーバーアロケーション）帯（人別ビュー専用） =====

export interface OverloadBand {
  x: number;
  width: number;
}

/**
 * computeOverloadRanges（lib/gantt/overload.ts）が返す日付区間を、マイルストーン帯と同じ
 * 「メンバー行ブロック内・position:relativeコンテナへの絶対配置」用のピクセル座標に変換する（純粋関数）。
 */
export function overloadRangesToBands(ranges: OverloadRange[], rangeStart: Date, dayWidth: number): OverloadBand[] {
  return ranges.map(r => {
    const s = toDate(r.start);
    const e = toDate(r.end);
    if (!s || !e) return { x: 0, width: 0 };
    return { x: diffDays(rangeStart, s) * dayWidth, width: (diffDays(s, e) + 1) * dayWidth };
  }).filter(b => b.width > 0);
}

// ===== バー端リサイズ（右端＝期日／左端＝開始日） =====

/** ドラッグ中のプレビュー日付。start/dueそれぞれ片方だけ書き換えている最中の状態を表す */
export interface ResizePreview {
  start?: string;
  due?: string;
}

/** プレビュー中の日付をタスクにマージした「実効タスク」を返す。preview が無ければ task をそのまま返す */
export function applyResizePreview(task: Task, preview: ResizePreview | undefined): Task {
  if (!preview) return task;
  return {
    ...task,
    ...(preview.start !== undefined ? { start_date: preview.start } : {}),
    ...(preview.due !== undefined ? { due_date: preview.due } : {}),
  };
}

/** 左端ドラッグ（開始日変更）のクランプ：開始日が期日を超えないようにする（同日は許可） */
export function clampStartDate(candidateStartDate: string, dueDate: string): string {
  return candidateStartDate > dueDate ? dueDate : candidateStartDate;
}

// ===== バー中央ドラッグ（タスク全体の移動） =====

/**
 * バー中央ドラッグによる全体移動：start_date/due_date を同じ日数だけシフトする（duration保持）。
 * origStartDate が null（期日のみタスク）の場合は due_date だけシフトする。
 * deltaDays===0 または origDueDate が無効な日付なら {}（プレビュー・保存とも no-op として扱われる）。
 */
export function computeMoveShift(origStartDate: string | null, origDueDate: string, deltaDays: number): ResizePreview {
  if (deltaDays === 0) return {};
  const due = toDate(origDueDate);
  if (!due) return {};
  const newDue = toDateStr(addDays(due, deltaDays));
  if (!origStartDate) return { due: newDue };
  const start = toDate(origStartDate);
  if (!start) return { due: newDue };
  return { start: toDateStr(addDays(start, deltaDays)), due: newDue };
}

// ===== 複数選択の一括シフト =====

export interface BulkMoveShift {
  taskId: string;
  oldStart: string | null;
  oldDue: string;
  newStart: string | null;
  newDue: string;
}

/**
 * 選択中の複数タスクを同じ日数だけシフトする際の、各タスクの新旧日付をまとめて計算する（純粋関数）。
 * 内部で computeMoveShift を1件ずつ適用するだけ（ロジックの二重化を避ける）。完了(done)・中止(cancelled)・
 * 削除済み・期日未設定のタスクは対象外にする（バー中央ドラッグの単体移動＝GanttView.tsxの
 * guardedHandleMoveDragStart/bulkTargets構築と同じ「done・cancelledは終わったタスクとしてシフト対象外」
 * ルールをここ1箇所に集約する。on_holdは引き続き対象＝個別ドラッグ可能なため）。
 */
export function computeBulkMoveShifts(tasks: Task[], deltaDays: number): BulkMoveShift[] {
  if (deltaDays === 0) return [];
  const result: BulkMoveShift[] = [];
  for (const task of tasks) {
    if (task.status === "done" || task.status === "cancelled" || task.is_deleted || !task.due_date) continue;
    const shift = computeMoveShift(task.start_date ?? null, task.due_date, deltaDays);
    if (Object.keys(shift).length === 0) continue;
    result.push({
      taskId: task.id,
      oldStart: task.start_date ?? null,
      oldDue: task.due_date,
      newStart: shift.start ?? null,
      newDue: shift.due!,
    });
  }
  return result;
}

// ===== キーボードショートカット：ズーム / 全選択 / 範囲選択 =====

/**
 * ZOOM_LEVELS 配列上で1段階ズームイン/アウトした次の値を返す（clamp：既に最大/最小なら現在値のまま）。
 * ズームボタンのクリックとキーボードショートカット（+/-）の両方がこの1関数を通ることで、
 * ロジックの二重化を避ける。
 */
export function clampZoom(current: number, direction: "in" | "out"): number {
  const idx = (ZOOM_LEVELS as readonly number[]).indexOf(current);
  if (idx < 0) return current;
  if (direction === "in") {
    return idx >= ZOOM_LEVELS.length - 1 ? current : ZOOM_LEVELS[idx + 1];
  }
  return idx <= 0 ? current : ZOOM_LEVELS[idx - 1];
}

/** Ctrl/Cmd+A・Shift+クリック範囲選択の対象となる「現在の表示順」を組み立てるための入力データ */
export interface VisibleOrderInput {
  viewMode: "pj" | "person";
  /** キー：PJ ID／`todo_${todoId}`／`person_${memberId}`／親タスクID。true＝折りたたみ中 */
  collapsed: Record<string, boolean>;
  personGroups: { memberId: string; taskIds: string[] }[];
  pjGroups: { pjId: string; rows: { taskId: string; depth: number; parentTaskId: string | null }[] }[];
  todoGroups: { todoId: string; taskIds: string[] }[];
}

/**
 * 現在画面に表示されているタスクバーのidを、表示順（PJ別ビュー＝PJ→親→子→ToDoグループ／
 * 人別ビュー＝担当者→タスク）で並べた配列にする（純粋関数）。GanttView本体のJSXレンダー順と
 * 完全に対応させる必要があるため、折りたたみ（PJ／ToDoグループ／担当者／親タスク）を全て考慮する。
 * Ctrl/Cmd+A（表示中の全選択）とShift+クリック（範囲選択）の両方でこの1関数を共有する。
 */
export function computeVisibleOrderedTaskIds(input: VisibleOrderInput): string[] {
  const { viewMode, collapsed, personGroups, pjGroups, todoGroups } = input;
  const ids: string[] = [];
  if (viewMode === "person") {
    for (const g of personGroups) {
      if (collapsed[`person_${g.memberId}`]) continue;
      ids.push(...g.taskIds);
    }
    return ids;
  }
  for (const g of pjGroups) {
    if (collapsed[g.pjId]) continue;
    for (const row of g.rows) {
      if (row.depth > 0 && row.parentTaskId && collapsed[row.parentTaskId]) continue;
      ids.push(row.taskId);
    }
  }
  for (const g of todoGroups) {
    if (collapsed[`todo_${g.todoId}`]) continue;
    ids.push(...g.taskIds);
  }
  return ids;
}

// computeRangeSelection 本体は src/lib/selectionRange.ts に移動（上部で re-export 済み）。

// ===== ドラッグで期間を新規作成（期日未登録タスクの空行ドラッグ。CLAUDE.md v3.04） =====

/**
 * バー列コンテナ基準のx座標 → 日付。calcTaskBar が使う座標系（0 = rangeStart、1日 = dayWidth px）
 * の逆変換。期日未登録タスクの空行をドラッグして期間を新規作成する機能で、カーソル位置から
 * 「今指している日付」を求めるのに使う（GanttView側は ganttBodyRef.getBoundingClientRect() を
 * 基準にした `clientX - bodyRect.left` を x として渡す想定。既存の B2 矢印描画の座標変換と同じ基準）。
 */
export function xToDate(x: number, rangeStart: Date, dayWidth: number): Date {
  const dayIndex = Math.round(x / dayWidth);
  return addDays(rangeStart, dayIndex);
}

/**
 * ドラッグの始点・終点（順不同の日付文字列 YYYY-MM-DD）→ start/due（min/max）。
 * 同日ドラッグ（またはドラッグなしの単純クリック）は start=due の単日タスクとして許容する
 * （呼び出し側で特別扱いする必要はない）。
 */
export function computeDragCreateRange(dateA: string, dateB: string): { start: string; due: string } {
  return dateA <= dateB ? { start: dateA, due: dateB } : { start: dateB, due: dateA };
}

// ===== 共有行モデル（ganttRows）。左ラベル列・右バー列を1つの配列から描画する（CLAUDE.md v3.08） =====
//
// 【設計意図】旧実装は左ラベル列（labelBodyRef）と右バー列（scrollRef）がそれぞれ独立に
// PJ/ToDo/担当者のツリーを辿ってJSXを組み立てていたため、折りたたみ・簡易追加行・ヘッダー高さ
// などの表示条件をどちらか片方だけ変更してしまうと行数・行高さが非対称になり縦にズレる事故が
// v3.04〜v3.06で繰り返し発生した（CLAUDE.md該当changelog参照。個別修正はもぐら叩きで再発する）。
// ここでは「縦方向に並ぶ全行」を、折りたたみ・親折りたたみ・簡易追加行の表示可否まで含めて
// 1回だけ判定し、1つの配列（GanttRow[]）として組み立てる。GanttView.tsx はこの配列を
// 左右それぞれで1回ずつ map するだけにする（表示条件の分岐を二重に書かない）ことで、
// 行数・各行の高さが構造的に必ず一致する（ズレが原理的に起きない）。

/** PJ別ビュー・人別ビュー共通のグループ見出し行の高さ（PJ行／ToDoグループ行／担当者行）。 */
export const GANTT_GROUP_ROW_HEIGHT = 36;
/** タスク1件を表す行の高さ（PJ別／ToDo別／人別、全ビュー共通）。 */
export const GANTT_TASK_ROW_HEIGHT = 30;

export type GanttRowKind =
  | "pj-header" | "task" | "quick-add"
  | "todo-header" | "todo-task"
  | "person-header" | "person-task";

interface GanttRowCommon {
  /** React key。人別ビュー等で同じ task.id が複数ブロックに現れうるため、呼び出し側で
      ブロックキーを含めて組み立て一意にする */
  key: string;
  height: number;
  /** 同じブロック（PJ／ToDoグループ／担当者）に属する行を束ねる識別子。
      computeGanttBlockRanges が「連続する同じ blockKey の行」の累積Y範囲を算出するのに使う。
      既存の collapsed state のキー（pj.id／`todo_${id}`／`person_${id}`）とそのまま揃えている。 */
  blockKey: string;
}

export interface GanttPjHeaderRow extends GanttRowCommon { kind: "pj-header"; pj: Project; }
export interface GanttTaskRow extends GanttRowCommon { kind: "task"; task: Task; depth: number; childCount: number; pj: Project; }
export interface GanttQuickAddRow extends GanttRowCommon { kind: "quick-add"; pj: Project; }
export interface GanttTodoHeaderRow extends GanttRowCommon { kind: "todo-header"; todo: ToDo; todoId: string; tasks: Task[]; }
export interface GanttTodoTaskRow extends GanttRowCommon { kind: "todo-task"; task: Task; todoId: string; }
export interface GanttPersonHeaderRow extends GanttRowCommon { kind: "person-header"; member: Member; tasks: Task[]; }
export interface GanttPersonTaskRow extends GanttRowCommon { kind: "person-task"; task: Task; member: Member; }

export type GanttRow =
  | GanttPjHeaderRow | GanttTaskRow | GanttQuickAddRow
  | GanttTodoHeaderRow | GanttTodoTaskRow
  | GanttPersonHeaderRow | GanttPersonTaskRow;

export interface BuildPjViewGanttRowsInput {
  visibleProjects: Project[];
  /** PJ.id → 親→子の順に並んだタスク一覧（GanttView.tsx の pjOrderedTasksMap） */
  pjOrderedTasksMap: Map<string, { task: Task; depth: number; childCount: number }[]>;
  todoGroups: { todo: ToDo; todoId: string; tasks: Task[] }[];
  /** todoId → ソート済みタスク一覧（GanttView.tsx の todoGroupSortedMap） */
  todoGroupSortedMap: Map<string, Task[]>;
  /** 折りたたみ状態（キー：PJ.id／`todo_${todoId}`／親タスクid） */
  collapsed: Record<string, boolean>;
  /** プレビューモードでは簡易追加行を出さない */
  isPreview: boolean;
}

/**
 * PJ別ビューの全行を組み立てる（純粋関数）。折りたたみ（PJ／親タスク／ToDoグループ）・
 * 簡易追加行の表示可否（!isCollapsed && !isPreview）をここで1回だけ判定する。
 * GanttView.tsx はこの結果を左ラベル列・右バー列の両方でそのまま map するだけでよい。
 */
export function buildPjViewGanttRows(input: BuildPjViewGanttRowsInput): GanttRow[] {
  const { visibleProjects, pjOrderedTasksMap, todoGroups, todoGroupSortedMap, collapsed, isPreview } = input;
  const rows: GanttRow[] = [];
  for (const pj of visibleProjects) {
    const isCollapsed = !!collapsed[pj.id];
    rows.push({ kind: "pj-header", key: `pjh_${pj.id}`, height: GANTT_GROUP_ROW_HEIGHT, blockKey: pj.id, pj });
    if (!isCollapsed) {
      const ordered = pjOrderedTasksMap.get(pj.id) ?? [];
      for (const { task, depth, childCount } of ordered) {
        if (depth > 0 && task.parent_task_id && collapsed[task.parent_task_id]) continue;
        rows.push({ kind: "task", key: `${pj.id}_${task.id}`, height: GANTT_TASK_ROW_HEIGHT, blockKey: pj.id, task, depth, childCount, pj });
      }
      if (!isPreview) {
        rows.push({ kind: "quick-add", key: `qa_${pj.id}`, height: QUICK_ADD_ROW_HEIGHT, blockKey: pj.id, pj });
      }
    }
  }
  for (const g of todoGroups) {
    const blockKey = `todo_${g.todoId}`;
    const isCollapsed = !!collapsed[blockKey];
    rows.push({ kind: "todo-header", key: `todoh_${g.todoId}`, height: GANTT_GROUP_ROW_HEIGHT, blockKey, todo: g.todo, todoId: g.todoId, tasks: g.tasks });
    if (!isCollapsed) {
      const sorted = todoGroupSortedMap.get(g.todoId) ?? g.tasks;
      for (const task of sorted) {
        rows.push({ kind: "todo-task", key: `${blockKey}_${task.id}`, height: GANTT_TASK_ROW_HEIGHT, blockKey, task, todoId: g.todoId });
      }
    }
  }
  return rows;
}

/**
 * 人別ビューの全行を組み立てる（純粋関数）。担当者グループの折りたたみのみ判定する
 * （人別ビューには親子インデント・簡易追加行が無いため、PJ別ビューより単純）。
 */
export function buildPersonViewGanttRows(
  personGroups: { member: Member; tasks: Task[] }[],
  collapsed: Record<string, boolean>,
): GanttRow[] {
  const rows: GanttRow[] = [];
  for (const { member, tasks } of personGroups) {
    const blockKey = `person_${member.id}`;
    const isCollapsed = !!collapsed[blockKey];
    rows.push({ kind: "person-header", key: `personh_${member.id}`, height: GANTT_GROUP_ROW_HEIGHT, blockKey, member, tasks });
    if (!isCollapsed) {
      for (const task of tasks) {
        rows.push({ kind: "person-task", key: `${blockKey}_${task.id}`, height: GANTT_TASK_ROW_HEIGHT, blockKey, task, member });
      }
    }
  }
  return rows;
}

/**
 * ganttRows の各行の高さを先頭から積み上げ、ブロック（PJ／ToDoグループ／担当者。blockKeyで判別）
 * ごとのY範囲（top＝ブロック先頭行の開始Y、height＝ブロック内の全行の高さ合計）を返す（純粋関数）。
 * マイルストーン帯・過負荷帯を「バー列全体を覆う絶対配置オーバーレイ」として描く際の座標源になる
 * （CLAUDE.md v3.08。同じ blockKey の行は必ず連続している＝buildPjViewGanttRows/
 * buildPersonViewGanttRows の組み立て方に由来する前提）。
 */
export function computeGanttBlockRanges(rows: GanttRow[]): Map<string, { top: number; height: number }> {
  const map = new Map<string, { top: number; height: number }>();
  let y = 0;
  for (const row of rows) {
    const existing = map.get(row.blockKey);
    if (existing) {
      existing.height += row.height;
    } else {
      map.set(row.blockKey, { top: y, height: row.height });
    }
    y += row.height;
  }
  return map;
}

/** ganttRows の全行の高さ合計。左右の総高さが一致することを確認する用途（ユニットテスト参照）。 */
export function computeGanttRowsTotalHeight(rows: GanttRow[]): number {
  return rows.reduce((sum, r) => sum + r.height, 0);
}
