// src/lib/task/saveInDepthOrder.ts
//
// 【設計意図】
// 複製・PJ引き継ぎで新しく作ったタスク群を保存するとき、parent_task_id の外部キー制約により
// 「親が先に保存されてから子」でなければ失敗する。階層が任意の深さになったため、
// 「最上位→子」の2波ではなく、深さごとの波（wave）に分けて浅い順に直列で保存する
// （同じ波の中は並列）。親の保存が失敗した子は、親なしに落として保存を試みる（従来と同じ方式）。

import type { Task } from "../localData/types";
import { MAX_TASK_DEPTH } from "../taskHierarchy";

/** tasks を深さ別の波に分ける。親が tasks に居ないタスクは波0。循環など辿れないものは波0に入れる。 */
export function splitIntoDepthWaves(tasks: Task[]): Task[][] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const depthOf = (t: Task): number => {
    let d = 0;
    const seen = new Set<string>([t.id]);
    let cur = t.parent_task_id ? byId.get(t.parent_task_id) : undefined;
    while (cur) {
      if (seen.has(cur.id)) return 0; // 循環：波0に置く（保存時に親なしへ落とす）
      seen.add(cur.id);
      d++;
      if (d > MAX_TASK_DEPTH) return 0;
      cur = cur.parent_task_id ? byId.get(cur.parent_task_id) : undefined;
    }
    return d;
  };
  const waves: Task[][] = [];
  for (const t of tasks) {
    const d = depthOf(t);
    (waves[d] ??= []).push(t);
  }
  return waves.filter(Boolean);
}

/**
 * 深さの浅い波から順に save する。戻り値は保存に成功したタスクIDの集合。
 * 親が（この呼び出しの中で）保存に失敗した、または親が tasks に居ないのに parent_task_id を持つ子は、
 * parent_task_id を null にして保存を試みる。
 */
export async function saveTasksInDepthOrder(
  tasks: Task[],
  save: (t: Task) => Promise<unknown>,
): Promise<Set<string>> {
  const succeeded = new Set<string>();
  const inSet = new Set(tasks.map(t => t.id));
  for (const wave of splitIntoDepthWaves(tasks)) {
    const toSave = wave.map(t =>
      t.parent_task_id && (!inSet.has(t.parent_task_id) || !succeeded.has(t.parent_task_id))
        ? { ...t, parent_task_id: null }
        : t,
    );
    const results = await Promise.allSettled(toSave.map(t => save(t)));
    toSave.forEach((t, i) => { if (results[i].status === "fulfilled") succeeded.add(t.id); });
  }
  return succeeded;
}
