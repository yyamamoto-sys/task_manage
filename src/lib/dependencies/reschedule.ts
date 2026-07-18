// src/lib/dependencies/reschedule.ts
//
// 【設計意図】タスク依存関係 フェーズB3：自動リスケジュール連鎖。
// モデル＝制約充足プッシュ（constraint-only push）。
// - 後続タスクを動かすのは「先行の（更新後の）期日が、後続の開始日を追い越した時だけ」。
//   余裕があるなら動かさない（同日開始は可＝ギャップ強制なし）。
// - 動かす量は「ぶつからない位置まで」だけ。FS制約：後続.start >= 先行.due。
//   違反時、delta = 先行.due - 後続.start、新start = 先行.due、新due = 後続.due + delta
//   （作業期間＝due-startの日数差を保持する）。
// - 押す方向のみ（先行が前倒しになっても後続を自動で引き寄せない。delta<=0なら何もしない）。
// - 複数先行は「全先行の期日の最大値」で後続の必要開始日を判定する。
// - 連鎖はorigin（編集されたタスク）から末端までトポロジカル順で一括計算する
//   （保存が保存を呼ぶ無限ループを避けるため。各タスクの新startは1回だけ確定する）。
// - 後続に開始日(start_date)が無いタスクはスキップ（FSが計算できないため）。
//   後続に期日(due_date)が無いタスクもスキップ（作業期間を保持できないため）。
// - 先行に期日(due_date)が無ければその先行からの制約は無視する（押せない）。
// - 暦日計算（土日祝を飛ばさない）。FS依存1種のみ。
//
// この関数は純粋関数（副作用なし）。DB書き込み・store更新は呼び出し側（appStore.saveTask）が行う。

import type { Task, TaskDependency } from "../localData/types";
import { toDate, toDateStr, addDays, diffDays } from "../date";

export interface CascadeShift {
  taskId: string;
  oldStart: string;
  oldDue: string;
  newStart: string;
  newDue: string;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = toDate(dateStr);
  if (!d) return dateStr;
  return toDateStr(addDays(d, days));
}

/**
 * originTaskId（今保存されたタスク）から辿れる後続タスク群について、
 * FS制約（後続.start >= 先行.due）を満たすために必要な日付シフトを計算する。
 *
 * allTasks には origin の更新後の値（新しい due_date 等）が反映済みであること
 * （appStore.saveTask が楽観更新後の state を渡す想定）。
 */
export function computeCascadeShifts(
  originTaskId: string,
  allTasks: Task[],
  allDeps: TaskDependency[],
): CascadeShift[] {
  return computeCascadeShiftsMulti([originTaskId], allTasks, allDeps);
}

/**
 * 複数origin版（ガント複数選択の一括シフト用）。originTaskIds（今まとめてシフトされた
 * タスク群）のいずれかから辿れる後続タスク群について、FS制約を満たすために必要な日付
 * シフトを1回のトポロジカル順パスで一括計算する（計算方法は単一originと同じ。origin集合を
 * 複数点からのBFSに拡張しただけ）。
 *
 * BFS・トポロジカルソート自体はorigin集合を特別扱いせず素直に走らせる（単一origin時に
 * 循環データが混入していた場合の安全網＝Kahnがデッドロックしてreachable全体を網羅できず
 * 早期returnする、という既存の防御を複数origin版でも完全に同じ形で保つため）。
 * origin同士が直接の依存で繋がっている場合（例：AとBを両方選択してドラッグ、A→Bの依存あり）
 * だけ、ループの中でorigin自身への shift 適用をスキップする（origin群は既にbulk shift側で
 * 同じdeltaだけ直接シフト済み・相対的な位置関係はシフト前後で変わらないため、他originからの
 * 制約でorigin自身を二重にカスケードシフトしない）。
 *
 * allTasks には origin群の更新後の値（新しい due_date 等）が反映済みであること。
 */
export function computeCascadeShiftsMulti(
  originTaskIds: string[],
  allTasks: Task[],
  allDeps: TaskDependency[],
): CascadeShift[] {
  const taskById = new Map<string, Task>();
  for (const t of allTasks) {
    if (!t.is_deleted) taskById.set(t.id, t);
  }
  const origins = originTaskIds.filter(id => taskById.has(id));
  if (origins.length === 0) return [];
  const originSet = new Set(origins);

  const successorsOf = new Map<string, string[]>();
  const predecessorsOf = new Map<string, string[]>();
  for (const d of allDeps) {
    if (d.is_deleted) continue;
    if (!taskById.has(d.predecessor_task_id) || !taskById.has(d.successor_task_id)) continue;
    successorsOf.set(
      d.predecessor_task_id,
      [...(successorsOf.get(d.predecessor_task_id) ?? []), d.successor_task_id],
    );
    predecessorsOf.set(
      d.successor_task_id,
      [...(predecessorsOf.get(d.successor_task_id) ?? []), d.predecessor_task_id],
    );
  }

  // origin群から辿れる後続タスク（間接含む）を複数始点BFSで収集する（origin自身は特別扱いせず、
  // 循環データで原点に戻ってきた場合も単一origin時と同じくreachableに入る＝下の安全網で検出される）。
  const reachable = new Set<string>();
  const bfsQueue: string[] = [...origins];
  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!;
    for (const succ of successorsOf.get(cur) ?? []) {
      if (!reachable.has(succ)) {
        reachable.add(succ);
        bfsQueue.push(succ);
      }
    }
  }
  if (reachable.size === 0) return [];

  // reachable集合内でトポロジカル順に並べる（Kahnのアルゴリズム）。
  // reachable外の先行（origin群以外の外部タスク）は日付が動かないので順序を気にする必要はなく、
  // taskById からそのまま読む。origin群からreachableノードへの辺はinDegreeに数えない
  // （数えるとoriginがKahn走査でpopされないため、そのカウントが永遠に減算されずデッドロックする）。
  const inDegree = new Map<string, number>();
  for (const id of reachable) inDegree.set(id, 0);
  for (const id of reachable) {
    for (const p of predecessorsOf.get(id) ?? []) {
      if (reachable.has(p)) {
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }
  }
  const queue: string[] = [];
  for (const id of reachable) if ((inDegree.get(id) ?? 0) === 0) queue.push(id);
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topoOrder.push(cur);
    for (const succ of successorsOf.get(cur) ?? []) {
      if (!reachable.has(succ)) continue;
      const next = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, next);
      if (next === 0) queue.push(succ);
    }
  }
  // 循環が紛れ込んでいた場合の防御（B1のcanAddDependencyで通常は発生しない）。
  // トポロジカル順が全ノードを網羅できないなら、安全側に倒して何もしない。
  if (topoOrder.length < reachable.size) return [];

  // 各タスクの「確定した期日」を追跡する（未シフトなら元のdue_date、シフト済みなら新due）。
  // origin群はそれぞれ自身の（更新後の）期日で初期化する。
  const currentDue = new Map<string, string | null>();
  for (const originId of origins) {
    currentDue.set(originId, taskById.get(originId)!.due_date ?? null);
  }

  const shifts: CascadeShift[] = [];

  for (const id of topoOrder) {
    const task = taskById.get(id)!;
    const preds = predecessorsOf.get(id) ?? [];

    // 全先行の期日の最大値 = このタスクに必要な最早開始日
    let requiredStart: string | null = null;
    for (const p of preds) {
      const pDue = currentDue.has(p) ? currentDue.get(p) : (taskById.get(p)?.due_date ?? null);
      if (!pDue) continue; // 先行に期日が無ければその先行からの制約は無視
      if (requiredStart === null || pDue > requiredStart) requiredStart = pDue;
    }

    // デフォルトはシフト無し（このタスクの期日は変わらない）
    currentDue.set(id, task.due_date ?? null);

    // origin自身（bulk側で既に同delta分だけ直接シフト済みのタスク）は、他originからの制約で
    // 二重にカスケードシフトしない。単一origin呼び出し時、原点は循環データ以外ではそもそも
    // topoOrderに現れない（＝このcontinueは実質到達しない）ので既存の単一origin挙動と完全互換。
    if (originSet.has(id)) continue;

    if (requiredStart === null) continue;           // 制約する先行が無い
    if (!task.start_date || !task.due_date) continue; // 開始日/期日が無い後続はスキップ（FS計算・作業期間保持ができない）
    if (requiredStart <= task.start_date) continue;  // 余裕がある（delta<=0）→ 動かさない

    const delta = diffDays(task.start_date, requiredStart); // requiredStart - start_date（>0）
    const newStart = requiredStart;
    const newDue = addDaysToDateStr(task.due_date, delta); // 作業期間を保持

    shifts.push({
      taskId: id,
      oldStart: task.start_date,
      oldDue: task.due_date,
      newStart,
      newDue,
    });
    currentDue.set(id, newDue);
  }

  return shifts;
}
