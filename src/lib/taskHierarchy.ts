// src/lib/taskHierarchy.ts
//
// 【設計意図】
// タスク階層（PJ > 大タスク > 小タスク・2階層固定）の「唯一の真実」。
// 親のステータス・進捗は子から都度算出する派生値であり、DB には保存しない
// （CLAUDE.md / docs/dev/task-hierarchy-design.md §5.5「派生値は state に保存しない」方針）。
// List・Dashboard・ProjectKarte・payloadBuilder・AI・DnD は必ずこのヘルパーを使い、
// 各所で再実装しない。進捗% は既存 stats.ts の calcProgressPct を再利用する
// （新しい進捗計算式を作らない）。
//
// 【マイグレーション未適用でも安全に動くこと】
// parent_task_id=undefined / display_order=undefined を許容する。
// - 親なし扱い（全タスク最上位） → 誰も子を持たない＝全タスクが葉
// - ソートは display_order ?? 0
// したがってフラットなデータでは「葉=全タスク」となり、進捗集計は従来と完全一致する。

import type { Task, TaskDependency } from "./localData/types";
import { calcProgressPct } from "./stats";

/** display_order（未設定は0）→ created_at の昇順で安定ソートする内部ヘルパー */
function sortByOrder(a: Task, b: Task): number {
  const oa = a.display_order ?? 0;
  const ob = b.display_order ?? 0;
  if (oa !== ob) return oa - ob;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/**
 * parentId の非削除の子（display_order→created_at 順）。
 * dependencies を渡すと、同じ親を共有する子同士に限り依存関係順（先行→後続）で
 * 並べ替える（orderSiblingsWithDependencies 参照）。渡さない場合は従来どおり
 * display_order 順のみ（既存呼び出しへの後方互換）。
 */
export function childrenOf(tasks: Task[], parentId: string, dependencies?: TaskDependency[]): Task[] {
  const base = tasks
    .filter(t => !t.is_deleted && t.parent_task_id === parentId)
    .sort(sortByOrder);
  return dependencies ? orderSiblingsWithDependencies(base, dependencies) : base;
}

/**
 * 同じ親を共有する兄弟タスク配列を、依存関係（先行タスク→後続タスク）を考慮して
 * 安定トポロジカルソートで並べ替える純粋関数。
 *
 * 【並び順ルール】
 * - 先行タスクは必ず後続タスクより上（チェーン A→B→C・複数先行も対応）
 * - 依存で縛られていない兄弟同士は、渡された children の並び（呼び出し側の
 *   sortByOrder / 日付順等、既存の並び順）をそのまま保つ（＝安定ソート）
 * - dependencies は「先行・後続の両方が children に含まれるペア」のみを制約として使う。
 *   片方でも children に含まれないエッジ（親をまたぐ依存・別グループの子）は無視する。
 *   呼び出し側は「同じ親を持つ子だけの配列」を渡す前提（childrenOf 等がこれを担保する）
 * - 論理削除された依存（is_deleted）は無視する
 *
 * 【アルゴリズム】Kahn法のトポロジカルソートを、「まだ出力しておらず入次数0のノードのうち
 * children 配列で最も手前にあるもの」を毎回選ぶ方式にすることで、制約の無い部分は
 * 元の並び順をそのまま保つ「安定」トポロジカルソートになる。
 *
 * 【循環フォールバック】B1（cycleCheck.ts）で新規追加時の循環は防止済みのため通常は
 * 起こらないが、万一トポロジカルソートが完結しない（循環が残っている）場合は例外を
 * 投げず、渡された children の並び（＝呼び出し側の display_order 順）をそのまま返す。
 */
export function orderSiblingsWithDependencies(
  children: Task[],
  dependencies: TaskDependency[],
): Task[] {
  if (children.length < 2) return children;

  const ids = children.map(t => t.id);
  const indexSet = new Set(ids);
  const outEdges = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>(ids.map(id => [id, 0]));

  for (const d of dependencies) {
    if (d.is_deleted) continue;
    const from = d.predecessor_task_id;
    const to = d.successor_task_id;
    if (from === to) continue;
    if (!indexSet.has(from) || !indexSet.has(to)) continue; // 親をまたぐ／範囲外のエッジは無視
    const set = outEdges.get(from) ?? new Set<string>();
    if (!set.has(to)) {
      set.add(to);
      outEdges.set(from, set);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const remaining = new Set(ids);
  const resultIds: string[] = [];
  while (remaining.size > 0) {
    let picked: string | null = null;
    for (const id of ids) {
      if (remaining.has(id) && (inDegree.get(id) ?? 0) === 0) { picked = id; break; }
    }
    if (picked === null) {
      // 循環が残っていて解けない：クラッシュさせず display_order（元の並び）にフォールバック
      return children;
    }
    resultIds.push(picked);
    remaining.delete(picked);
    for (const succ of outEdges.get(picked) ?? []) {
      if (remaining.has(succ)) inDegree.set(succ, (inDegree.get(succ) ?? 0) - 1);
    }
  }

  const taskById = new Map(children.map(t => [t.id, t]));
  return resultIds.map(id => taskById.get(id)!);
}

/**
 * 親子が混在するフラットなタスク配列（例：担当者別・ToDo別に集めた一覧。GanttView人別ビュー・
 * GanttMobileView等）で、同じ parent_task_id を共有する要素同士の相対順序だけを
 * orderSiblingsWithDependencies で並べ替える。全体の並び（親タスクの位置・他の親の子との
 * 相対位置）は変えない。parent_task_id を持たないタスク（最上位）は対象外＝そのままの位置を保つ。
 */
export function applyDependencyOrderWithinSiblings(
  list: Task[],
  dependencies: TaskDependency[],
): Task[] {
  const groups = new Map<string, number[]>();
  list.forEach((t, i) => {
    if (!t.parent_task_id) return;
    const arr = groups.get(t.parent_task_id) ?? [];
    arr.push(i);
    groups.set(t.parent_task_id, arr);
  });
  if (groups.size === 0) return list;
  const result = list.slice();
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const subset = indices.map(i => list[i]);
    const reordered = orderSiblingsWithDependencies(subset, dependencies);
    indices.forEach((idx, k) => { result[idx] = reordered[k]; });
  }
  return result;
}

/**
 * task が子を1件以上持つか（＝大タスク）。
 * 子0件のフラットなタスクでは false → 葉として扱われる。
 */
export function isParentTask(task: Task, tasks: Task[]): boolean {
  return tasks.some(t => !t.is_deleted && t.parent_task_id === task.id);
}

/**
 * 子を持たないタスク（進捗集計の単位＝葉）。
 * フラットデータでは誰も子を持たないので「葉=全非削除タスク」になり、
 * done/total 集計が従来と完全一致する。
 */
export function leafTasks(tasks: Task[]): Task[] {
  // 子を持つ親IDの集合を先に作る（O(n) 化）
  const parentIds = new Set<string>();
  for (const t of tasks) {
    if (!t.is_deleted && t.parent_task_id) parentIds.add(t.parent_task_id);
  }
  return tasks.filter(t => !t.is_deleted && !parentIds.has(t.id));
}

/** 最上位タスク（parent_task_id 無し・非削除） */
export function topLevelTasks(tasks: Task[]): Task[] {
  return tasks
    .filter(t => !t.is_deleted && t.parent_task_id == null)
    .sort(sortByOrder);
}

/**
 * 子から親ステータスを算出：
 * - 子0件 → そのタスク自身の status（フラット/葉タスクは従来どおり手動値）
 * - 全done → "done"
 * - 1件でも done/in_progress があり、かつ全doneでない（＝todoとの混在含む）→ "in_progress"
 * - 全todo → "todo"
 */
export function rollupStatus(task: Task, tasks: Task[]): Task["status"] {
  const children = childrenOf(tasks, task.id);
  if (children.length === 0) return task.status;
  if (children.every(c => c.status === "done")) return "done";
  if (children.every(c => c.status === "todo")) return "todo";
  // done/in_progress/todo の混在（todoとdoneだけの混在も含む）→ in_progress
  return "in_progress";
}

/** 子の完了集計（calcProgressPct 使用） */
export function parentProgress(
  tasks: Task[],
  parentId: string,
): { done: number; total: number; pct: number } {
  const children = childrenOf(tasks, parentId);
  const total = children.length;
  const done = children.filter(c => c.status === "done").length;
  return { done, total, pct: calcProgressPct(done, total) };
}

/**
 * ある task の表示用ステータス（親なら導出・子無しなら自身）。
 * rollupStatus と同義だが、呼び出し意図を明確にするための薄いラッパ。
 */
export function effectiveStatus(task: Task, tasks: Task[]): Task["status"] {
  return rollupStatus(task, tasks);
}

export interface ParentDerived {
  status: Task["status"];
  done: number;
  total: number;
  pct: number;
}

/**
 * 全親タスクのステータス・進捗を1パス（O(n)）で一括算出する。
 * rollupStatus/parentProgress を一覧の行ごとに呼ぶと、呼ぶたびに childrenOf() が
 * 全タスクを走査するため実質 O(件数²) になる（一覧・カンバン等で多数の親を扱う場合に問題化）。
 * ロジックは rollupStatus/parentProgress と完全に同一・同じ結果を返す。
 * 単発でよい呼び出し（1タスクだけ知りたい）は従来どおり rollupStatus/parentProgress を使う。
 */
export function buildParentDerivedMap(tasks: Task[]): Map<string, ParentDerived> {
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.is_deleted || !t.parent_task_id) continue;
    const arr = childrenByParent.get(t.parent_task_id) ?? [];
    arr.push(t);
    childrenByParent.set(t.parent_task_id, arr);
  }
  const result = new Map<string, ParentDerived>();
  for (const [parentId, children] of childrenByParent) {
    const total = children.length;
    const done  = children.filter(c => c.status === "done").length;
    const status: Task["status"] = children.every(c => c.status === "done") ? "done"
      : children.every(c => c.status === "todo") ? "todo"
      : "in_progress";
    result.set(parentId, { status, done, total, pct: calcProgressPct(done, total) });
  }
  return result;
}

/**
 * PJ内で親に指定できる候補（2階層固定）。
 * - projectId が null → []（親子は同一PJ内のみ）
 * - 最上位タスク（parent_task_id 無し）のみを候補にする
 * - forTaskId（自分自身）は除外
 * - 子を持つタスクも除外しない…のではなく「孫禁止」のため、
 *   ここでは「子を持てる＝最上位」を候補に出す。小タスク（親持ち）は候補に出さない。
 *   （= forTaskId 自身と、親を持つ小タスクを除いた最上位タスク）
 */
export function eligibleParentTasks(
  tasks: Task[],
  projectId: string | null,
  forTaskId?: string,
): Task[] {
  if (projectId == null) return [];
  return tasks
    .filter(t =>
      !t.is_deleted &&
      t.project_id === projectId &&
      t.parent_task_id == null &&   // 最上位のみ（小タスクは親になれない＝孫禁止）
      t.id !== forTaskId,           // 自分自身を除外
    )
    .sort(sortByOrder);
}

/**
 * 親タスク選択用の候補。全PJの最上位タスク（parent_task_id 無し・非削除・自分以外）を、
 * currentProjectId と同じPJのものを先頭に、その後は他PJ、という順で返す。
 * （子を選ぶと子は親のPJに揃うため、他PJ親も許容。同一PJを優先表示する目的のヘルパー）
 */
export function parentTaskCandidates(
  tasks: Task[],
  currentProjectId: string | null,
  forTaskId?: string,
): Task[] {
  const tops = tasks
    .filter(t =>
      !t.is_deleted &&
      t.parent_task_id == null &&   // 最上位のみ（小タスクは親になれない＝孫禁止）
      t.id !== forTaskId,           // 自分自身を除外
    )
    .sort(sortByOrder);
  // 同一PJを先頭グループ、その後は他PJ。各グループ内は sortByOrder の並びを保つ（安定）。
  const same = tops.filter(t => t.project_id === currentProjectId);
  const other = tops.filter(t => t.project_id !== currentProjectId);
  return [...same, ...other];
}

/**
 * ある親タスクの「子タスクにできる候補」（親側から子を複数選ぶUI用）。
 * - 親タスクと同一 project_id（親子は同一PJ内に限定）
 * - 親タスク自身は除外
 * - 既に子を持つタスク（=親）は除外（2階層固定・孫禁止）
 * - 既に他タスクの子であるタスクも候補に含む（選ぶと付け替え。呼び出し側で現在の親を併記してよい）
 * 親タスクは最上位（parent_task_id 無し）である前提（呼び出し側で担保すること）。
 */
export function eligibleChildTasks(tasks: Task[], parent: Task): Task[] {
  return tasks
    .filter(t =>
      !t.is_deleted &&
      t.id !== parent.id &&
      (t.project_id ?? null) === (parent.project_id ?? null) &&
      !isParentTask(t, tasks),
    )
    .sort(sortByOrder);
}

/**
 * 「完了を隠す」表示フィルタ（ガントの🙈トグル用）の純粋関数。
 *
 * 単純に `status === "done"` のタスクを消すと、未完了の子を1件でも持つ親タスクまで
 * 一緒に消えてしまい、子だけが孤立表示される不整合が起きる。これを避けるため、
 * 判定は buildParentDerivedMap による実効ステータス（親＝子から算出したロールアップ、
 * 葉＝自身の status）で行う（effectiveStatus と同じ考え方を、O(n²) を避けて一括で適用する）。
 *
 * 渡された tasks 配列の中だけで親子関係が完結する前提（呼び出し側は mineOnly 等の表示
 * スコープを既に適用した「同じ配列」を渡すこと＝GanttView の allTasks がそれに当たる）。
 */
export function filterHideCompletedTasks(tasks: Task[]): Task[] {
  const derivedMap = buildParentDerivedMap(tasks);
  return tasks.filter(t => {
    const derived = derivedMap.get(t.id);
    const status = derived ? derived.status : t.status;
    return status !== "done";
  });
}
