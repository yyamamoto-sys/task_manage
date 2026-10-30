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
import { isCompletedForProgress } from "./taskMeta";

/** display_order（未設定は0）→ created_at の昇順で安定ソートする内部ヘルパー */
export function sortTasksByOrder(a: Task, b: Task): number {
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
    .sort(sortTasksByOrder);
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
 * 子が「全員終わっている」か（done または cancelled のみで構成、かつ1件以上）。
 * rollupStatus・computeParentAutoStatus の共通コア判定（CLAUDE.md 2026-07-21
 * 親タスク自動完了）。cancelled は「実施しないと決めて終わった」ので done と同じ
 * 「もう動かない」扱い。on_hold は「まだ動く可能性がある」ので終了とみなさない。
 */
function allChildrenTerminal(children: Task[]): boolean {
  return children.length > 0 && children.every(c => c.status === "done" || c.status === "cancelled");
}

/**
 * 子から親ステータスを算出（末端まで再帰。子が孫を持つなら、その子の実効ステータスを使う）：
 * - 子0件 → そのタスク自身の status（フラット/葉タスクは従来どおり手動値）
 * - 全員 done または cancelled → "done"
 * - 全todo → "todo"
 * - それ以外（in_progress混在・on_hold混在・done/todo混在など）→ "in_progress"
 */
export function rollupStatus(task: Task, tasks: Task[]): Task["status"] {
  return computeRollups(tasks).get(task.id)?.status ?? task.status;
}

/**
 * 子タスクの状態変化を受けて、親タスクの status を自動更新すべきか判定する純粋関数
 * （CLAUDE.md 2026-07-21 親タスク自動完了）。appStore.saveTask の choke point から、
 * 子タスク保存の副作用として呼ばれる想定。
 * - 子が0件（葉タスク）→ null（親子関係が無いので判定不要）
 * - 全ての子が done/cancelled → "done"（parent が既に done なら変更不要＝null）
 * - 親が既に done で、子が1件でも done/cancelled 以外に戻った → "in_progress" へ差し戻す
 *   （rollupStatus の値ではなく明示的に in_progress。一貫性を保つための単純な差し戻し）
 * - 上記いずれでもない → null（手動管理を尊重し、勝手に触らない）
 */
export function computeParentAutoStatus(parent: Task, children: Task[]): Task["status"] | null {
  if (children.length === 0) return null;
  if (allChildrenTerminal(children)) {
    return parent.status === "done" ? null : "done";
  }
  if (parent.status === "done") return "in_progress";
  return null;
}

/** 完了集計（calcProgressPct 使用）。数えるのは「末端（子を持たない）タスク」の完了数／総数。 */
export function parentProgress(
  tasks: Task[],
  parentId: string,
): { done: number; total: number; pct: number } {
  const r = computeRollups(tasks).get(parentId);
  const total = r?.total ?? 0;
  const done = r?.done ?? 0;
  return { done, total, pct: calcProgressPct(done, total) };
}

export interface ParentDerived {
  status: Task["status"];
  done: number;
  total: number;
  pct: number;
}

/** 階層の深さの打ち切り（循環・異常データでも止まるための上限。DB トリガーの上限と揃える） */
export const MAX_TASK_DEPTH = 32;
/** 画面のインデントに使う深さの上限（これ以上深くても横にはみ出さない） */
export const MAX_INDENT_LEVEL = 8;

/** 非削除タスクの親ID→子の配列（入力順を保つ。並べ替えは呼び出し側） */
export function buildChildrenMap(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.is_deleted || !t.parent_task_id) continue;
    const arr = map.get(t.parent_task_id) ?? [];
    arr.push(t);
    map.set(t.parent_task_id, arr);
  }
  return map;
}

export function buildTaskById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map(t => [t.id, t]));
}

/** 祖先タスク列（直近の親が先頭）。byId に無い・循環・MAX_TASK_DEPTH 超で打ち切る。 */
export function ancestorsOf(task: Task, byId: Map<string, Task>): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([task.id]);
  let cur = task.parent_task_id ? byId.get(task.parent_task_id) : undefined;
  while (cur && !seen.has(cur.id) && out.length < MAX_TASK_DEPTH) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.parent_task_id ? byId.get(cur.parent_task_id) : undefined;
  }
  return out;
}

/** 最上位=0 の深さ。byId に親が居なければ 0 扱い。 */
export function taskDepthOf(task: Task, byId: Map<string, Task>): number {
  return ancestorsOf(task, byId).length;
}

/** 子孫タスク列（幅優先・root 自身は含まない）。循環があっても各タスクは1回だけ。 */
export function descendantsOf(rootId: string, childrenMap: Map<string, Task[]>): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let level = 0; level < MAX_TASK_DEPTH && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const c of childrenMap.get(id) ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        next.push(c.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** taskId の親を newParentId にすると循環するか（自分自身・自分の子孫を親にする場合に true） */
export function wouldCreateParentCycle(tasks: Task[], taskId: string, newParentId: string | null | undefined): boolean {
  if (!newParentId) return false;
  if (newParentId === taskId) return true;
  const byId = buildTaskById(tasks);
  const np = byId.get(newParentId);
  if (!np) return false;
  return ancestorsOf(np, byId).some(a => a.id === taskId);
}

/** task から親をたどって、同じタスクに戻る（循環している）か。親が居ない・上限に達するまでに終われば false。 */
export function hasParentCycle(task: Task, byId: Map<string, Task>): boolean {
  const seen = new Set<string>([task.id]);
  let cur = task.parent_task_id ? byId.get(task.parent_task_id) : undefined;
  for (let i = 0; cur && i < MAX_TASK_DEPTH * 2; i++) {
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    cur = cur.parent_task_id ? byId.get(cur.parent_task_id) : undefined;
  }
  return false;
}

/** 「↳」の接頭辞。親を持つタスクは深さぶんの矢印（最大 MAX_INDENT_LEVEL）＋空白、持たなければ空文字。 */
export function parentArrowPrefix(task: Task, byId: Map<string, Task>): string {
  if (!task.parent_task_id) return "";
  const d = Math.max(1, ancestorsOf(task, byId).length);
  return "↳".repeat(Math.min(d, MAX_INDENT_LEVEL)) + " ";
}

/** インデント用の段数（MAX_INDENT_LEVEL で頭打ち） */
export function indentLevelOf(depth: number): number {
  return Math.max(0, Math.min(depth, MAX_INDENT_LEVEL));
}

export interface TreeRow {
  task: Task;
  depth: number;
  /** 直下の子の件数（この集合内。子を持つ＝親タスク） */
  childCount: number;
}

/**
 * タスクを「親→その子孫…」の木順（深さ優先）に並べ、深さと直下の子件数を付ける。
 * 親がこの集合に居ないタスクは最上位扱い。循環・上限超で最上位から辿れないタスクは
 * 末尾に最上位として足す（落とさない・無限ループしない）。
 * 兄弟の並びは呼び出し側の規則（sortTops／sortKids。依存順など）をそのまま使う。
 */
export function orderTasksAsTree(
  tasks: Task[],
  sortTops: (ts: Task[]) => Task[],
  sortKids: (ts: Task[]) => Task[] = sortTops,
): TreeRow[] {
  const ids = new Set(tasks.map(t => t.id));
  const childrenByParent = new Map<string, Task[]>();
  const tops: Task[] = [];
  for (const t of tasks) {
    if (t.parent_task_id && ids.has(t.parent_task_id) && t.parent_task_id !== t.id) {
      const arr = childrenByParent.get(t.parent_task_id) ?? [];
      arr.push(t);
      childrenByParent.set(t.parent_task_id, arr);
    } else {
      tops.push(t);
    }
  }
  const out: TreeRow[] = [];
  const visited = new Set<string>();
  const walk = (root: Task) => {
    const stack: { t: Task; d: number }[] = [{ t: root, d: 0 }];
    while (stack.length > 0) {
      const { t, d } = stack.pop()!;
      if (visited.has(t.id)) continue;
      visited.add(t.id);
      const kids = (childrenByParent.get(t.id) ?? []).filter(k => !visited.has(k.id));
      out.push({ task: t, depth: d, childCount: kids.length });
      const ordered = sortKids(kids);
      for (let i = ordered.length - 1; i >= 0; i--) stack.push({ t: ordered[i], d: d + 1 });
    }
  };
  for (const top of sortTops(tops)) walk(top);
  if (visited.size < tasks.length) {
    for (const t of sortTops(tasks.filter(x => !visited.has(x.id)))) walk(t);
  }
  return out;
}

interface RollupInfo {
  status: Task["status"];
  done: number;
  total: number;
  start?: string;
  due?: string;
}

/**
 * 全親タスクの派生値（実効ステータス・末端の完了数/総数・期間の巻き上げ）を1パス（O(n)）で算出する。
 * 子が孫を持つ場合は再帰して末端まで集計する。循環・MAX_TASK_DEPTH 超は葉として打ち切る。
 * 戻り値には「子を持つタスク」だけが入る（葉は含まない）。
 */
function computeRollups(tasks: Task[]): Map<string, RollupInfo> {
  const kidsMap = buildChildrenMap(tasks);
  const result = new Map<string, RollupInfo>();
  const visiting = new Set<string>();
  const leaf = (t: Task): RollupInfo => ({
    status: t.status,
    done: t.status === "done" ? 1 : 0,
    total: 1,
    start: t.start_date || undefined,
    due: t.due_date || undefined,
  });
  const calc = (t: Task, depth: number): RollupInfo => {
    const kids = kidsMap.get(t.id);
    if (!kids || kids.length === 0 || visiting.has(t.id) || depth >= MAX_TASK_DEPTH) return leaf(t);
    const cached = result.get(t.id);
    if (cached) return cached;
    visiting.add(t.id);
    const infos = kids.map(k => calc(k, depth + 1));
    visiting.delete(t.id);
    const statuses = infos.map(i => i.status);
    const status: Task["status"] = statuses.every(s => s === "done" || s === "cancelled") ? "done"
      : statuses.every(s => s === "todo") ? "todo"
      : "in_progress";
    const starts = infos.map(i => i.start).filter((s): s is string => !!s).sort();
    const dues = infos.map(i => i.due).filter((s): s is string => !!s).sort();
    const info: RollupInfo = {
      status,
      done: infos.reduce((n, i) => n + i.done, 0),
      total: infos.reduce((n, i) => n + i.total, 0),
      start: starts[0],
      due: dues[dues.length - 1],
    };
    result.set(t.id, info);
    return info;
  };
  for (const t of tasks) {
    if (!t.is_deleted && kidsMap.has(t.id)) calc(t, 0);
  }
  return result;
}

/**
 * 全親タスクのステータス・進捗を1パス（O(n)）で一括算出する。
 * 進捗は「末端（子を持たない）タスクの完了数／末端の総数」。2段の木では従来（直下の子の数）と同じ結果になる。
 * 単発でよい呼び出し（1タスクだけ知りたい）は rollupStatus/parentProgress でもよい（内部は同じ計算）。
 */
export function buildParentDerivedMap(tasks: Task[]): Map<string, ParentDerived> {
  const result = new Map<string, ParentDerived>();
  for (const [id, r] of computeRollups(tasks)) {
    result.set(id, { status: r.status, done: r.done, total: r.total, pct: calcProgressPct(r.done, r.total) });
  }
  return result;
}

/** 親タスクごとの実効期間（末端タスクの最早開始〜最遅期日）。子を持たないタスクは含まない。 */
export function buildEffectiveDatesMap(
  tasks: Task[],
): Map<string, { start_date: string | undefined; due_date: string | undefined }> {
  const map = new Map<string, { start_date: string | undefined; due_date: string | undefined }>();
  for (const [id, r] of computeRollups(tasks)) map.set(id, { start_date: r.start, due_date: r.due });
  return map;
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
    .sort(sortTasksByOrder);
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
    .sort(sortTasksByOrder);
}

/** 葉タスクの慣例的な進捗率（0〜1）。0〜100%の実測フィールドが無いための代替表現
 *  （todo=0 / in_progress=0.5 / done=1）。実測%を持たせる場合は将来DB列＋入力UIが必要（今回は未対応）。
 *  cancelled は isCompletedForProgress と同じ基準で done と同じ1（100%）扱いにする
 *  （M33解消・CLAUDE.md 2026-07-22。「実施しないと決めて終わった」= もう動かないため、
 *  進捗フィルの表現上も完了扱いに揃える）。on_hold は「まだ動く可能性がある」ため引き続き0のまま。 */
function leafProgressFraction(status: Task["status"]): number {
  if (isCompletedForProgress(status)) return 1;
  if (status === "in_progress") return 0.5;
  return 0;
}

/**
 * タスクの進捗率（0〜1）を算出する純粋関数（ガントのバー内進捗フィル用）。
 * - 子を持つ親タスク：子からのロールアップ（parentProgress の pct を 0〜1 に正規化）
 * - 子を持たない葉タスク：ステータス由来の慣例値（leafProgressFraction）
 * 単発呼び出し用。一覧描画（多数行）では buildProgressFractionMap（O(n)一括版）を使うこと。
 */
export function taskProgressFraction(task: Task, tasks: Task[]): number {
  const { total, pct } = parentProgress(tasks, task.id);
  if (total > 0) return pct / 100;
  return leafProgressFraction(task.status);
}

/**
 * taskProgressFraction の一括版（O(n)）。buildParentDerivedMap を1回計算し、親はそこから、
 * 葉はステータスから算出する。GanttView のように多数行を描画する画面向け
 * （行ごとに taskProgressFraction を呼ぶと親判定のたびに childrenOf が全走査し O(n²) になる。
 * buildParentDerivedMap と同じ理由で分離した一括版）。
 */
export function buildProgressFractionMap(tasks: Task[]): Map<string, number> {
  const derivedMap = buildParentDerivedMap(tasks);
  const map = new Map<string, number>();
  for (const t of tasks) {
    if (t.is_deleted) continue;
    const derived = derivedMap.get(t.id);
    map.set(t.id, derived ? derived.pct / 100 : leafProgressFraction(t.status));
  }
  return map;
}

/**
 * 「完了を隠す」表示フィルタ（ガントの🙈トグル用）の純粋関数。
 *
 * 単純に `status === "done"` のタスクを消すと、未完了の子を1件でも持つ親タスクまで
 * 一緒に消えてしまい、子だけが孤立表示される不整合が起きる。これを避けるため、
 * 判定は buildParentDerivedMap による実効ステータス（親＝子から算出したロールアップ、
 * 葉＝自身の status）で行う（rollupStatus と同じ考え方を、O(n²) を避けて一括で適用する）。
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
