// 「全て」のページの、画面に依存しない計算。
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

export interface SummaryCard {
  key: "picks" | "claims" | "reflect";
  label: string;
  value: string;
  /** 押すと「わたし」のページのどこへ移るか */
  anchor: string;
}

/** わたしの要約のカード。件数が無い項目は出さない（3つとも無ければ空） */
export function summaryCards(a: { picks: number; pending: number; reflectKrs: number; reflectDone: number }): SummaryCard[] {
  const out: SummaryCard[] = [];
  if (a.picks > 0) out.push({ key: "picks", label: "今週やる仕事", value: `${a.picks}件`, anchor: "mk-picks-h" });
  if (a.pending > 0) out.push({ key: "claims", label: "確かめる", value: `${a.pending}件`, anchor: "mk-claims-h" });
  if (a.reflectKrs > 0) out.push({ key: "reflect", label: "今週の振り返り", value: a.reflectDone >= a.reflectKrs ? "済み" : "まだ", anchor: "mk-reflect-h" });
  return out;
}
