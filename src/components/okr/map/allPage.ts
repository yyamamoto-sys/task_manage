// 流れの図を「全体」にしたときの、画面に依存しない計算。
import type { FlowCounts } from "./flow";
import { krIdsOfTask, type LinkCtx } from "./logic";

/** 地図に出ている仕事（KRにつながる仕事＋つながらない仕事。1件は1回）のうち、見ている人の仕事のID */
export function mineTaskIds(counts: FlowCounts, ownerId: string): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(counts.linkedByPj)) for (const t of list) if (t.assigneeId === ownerId) ids.add(t.id);
  return ids;
}

export interface MineLine {
  total: number;
  mine: number;
  /** あなたの仕事がつながっているKR（krIds の並び順） */
  krs: string[];
}

export function mineLine(counts: FlowCounts, ownerId: string, krIds: string[], ctx: LinkCtx): MineLine {
  const linked = Object.values(counts.linkedByPj).flat();
  const myLinked = linked.filter((t) => t.assigneeId === ownerId);
  const myLoose = counts.loose.filter((t) => t.assigneeId === ownerId);
  const krSet = new Set(myLinked.flatMap((t) => krIdsOfTask(t, ctx)));
  return { total: linked.length + counts.loose.length, mine: myLinked.length + myLoose.length, krs: krIds.filter((k) => krSet.has(k)) };
}

/** あなたの分の1行。「0件」とは書かない */
export function mineLineText(line: MineLine, krLabelOf: (id: string) => string): string {
  if (line.mine === 0) return "あなたの仕事はまだ登録されていません。";
  const head = `チームの仕事 ${line.total}件のうち、あなたの仕事は ${line.mine}件です。`;
  return line.krs.length > 0 ? `${head}${line.krs.map(krLabelOf).join("・")} につながっています。` : head;
}
