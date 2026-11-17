// 利用の広がり：仕事の「登録」がどこまであるか。画面には依存しない純粋関数だけを置く。
// 成果（見立ての段・手がかりの数字）はチェックイン資料から取るので、誰が使っていても同じ。登録の有無で変わるのは仕事の側だけ。
// 登録が無いことは「仕事が無い」ではない。ここでは「登録なし」と「登録あり」を区別するための判定を持つ。
import { inPeriod, krIdsOfTask, PERSONAL_PJ, type LinkCtx } from "./logic";
import type { Checkin, Task } from "./types";

/** all＝全員が登録／pjs＝一部のPJだけ登録／solo＝見ている人の分だけ登録（モックの確認用の切替） */
export type Reach = "all" | "pjs" | "solo";

export type Registration = "full" | "partial" | "none";

/** アプリに登録された仕事。pjs は pjSubset のPJの仕事（PJに属さない個人の仕事は含めない）、solo は見ている人の仕事だけ */
export function registeredTasks(all: Task[], reach: Reach, viewerId: string, pjSubset: string[]): Task[] {
  if (reach === "all") return all;
  if (reach === "solo") return all.filter((t) => t.assigneeId === viewerId);
  return all.filter((t) => pjSubset.includes(t.pjId));
}

/** 今期の登録された仕事が1件でもあるPJ（PJに属さない個人の仕事は数えない） */
export function registeredPjIds(tasks: Task[], periodStart: string): Set<string> {
  return new Set(tasks.filter((t) => t.pjId !== PERSONAL_PJ && inPeriod(t, periodStart)).map((t) => t.pjId));
}

export const pjsOfTf = (tfId: string, ctx: LinkCtx): string[] => ctx.pjs.filter((p) => p.tfIds.includes(tfId)).map((p) => p.id);

export function pjsOfKr(krId: string, ctx: LinkCtx): string[] {
  const tfIds = ctx.items.filter((i) => i.kind === "tf" && i.parentId === krId).map((i) => i.id);
  return ctx.pjs.filter((p) => p.tfIds.some((id) => tfIds.includes(id))).map((p) => p.id);
}

const level = (total: number, registered: number): Registration => (registered === 0 ? "none" : registered === total ? "full" : "partial");

export function pjHasRegistration(pjId: string, tasks: Task[], periodStart: string): boolean {
  return registeredPjIds(tasks, periodStart).has(pjId);
}

/** TFにつながるPJのうち、登録があるのがいくつか。PJが1つも無いTFは「登録なし」 */
export function tfRegistration(tfId: string, tasks: Task[], ctx: LinkCtx, periodStart: string): Registration {
  const pjs = pjsOfTf(tfId, ctx);
  const reg = registeredPjIds(tasks, periodStart);
  return pjs.length === 0 ? "none" : level(pjs.length, pjs.filter((p) => reg.has(p)).length);
}

/**
 * KRにつながる仕事が1件でも登録されていれば「登録あり」。そのKRのPJのすべてに登録があれば full、一部だけなら partial。
 * つなぎ先を選び直した仕事（PJの既定と別のKR）も「つながっている」に数える
 */
export function krRegistration(krId: string, tasks: Task[], ctx: LinkCtx, periodStart: string): Registration {
  const linked = tasks.some((t) => inPeriod(t, periodStart) && krIdsOfTask(t, ctx).includes(krId));
  const pjs = pjsOfKr(krId, ctx);
  const reg = registeredPjIds(tasks, periodStart);
  const n = pjs.filter((p) => reg.has(p)).length;
  if (!linked) return "none";
  return n === pjs.length ? "full" : "partial";
}

export interface ReachCounts {
  registered: number;
  total: number;
}

/** 分母＝今期のTF（Kintone から取り込んだもの）につながるPJの数、分子＝そのうち仕事の登録があるPJの数 */
export function reachCounts(tasks: Task[], ctx: LinkCtx, periodStart: string): ReachCounts {
  const tfIds = new Set(ctx.items.filter((i) => i.kind === "tf").map((i) => i.id));
  const pjs = ctx.pjs.filter((p) => p.tfIds.some((id) => tfIds.has(id)));
  const reg = registeredPjIds(tasks, periodStart);
  return { registered: pjs.filter((p) => reg.has(p.id)).length, total: pjs.length };
}

/** 地図の凡例の近くに出す範囲の注記。全部に登録があるときは出さない（null） */
export function reachNote(c: ReachCounts): string | null {
  return c.total > 0 && c.registered < c.total ? `仕事はアプリに登録された分です（${c.total}PJ中${c.registered}PJ）` : null;
}

/** 件数の言い方。0件は「0件」と書かず、穏やかな言い方にする */
export function workPhrase(done: number, open: number): string {
  return `${done > 0 ? `終えた仕事${done}件` : "終えた仕事はまだありません"}、${open > 0 ? `残り${open}件` : "残りはありません"}`;
}

// ---------- 成果の推移（チェックインの回ごとの値） ----------

export interface HistoryEntry {
  date: string;
  value: number;
}
export type History = Record<string, HistoryEntry[]>;

export interface TrendPoint {
  checkinId: string;
  date: string;
  value: number;
  /** その回の資料で更新された値か。false＝資料に出てこず、前の値のまま（未更新） */
  updated: boolean;
}

/** 確定で更新されたKRの値を、その回の日付で記録する（同じ日の再確定は置き換える） */
export function addHistory(history: History, krIds: string[], values: Record<string, number>, date: string): History {
  const out: History = { ...history };
  for (const k of krIds) {
    const v = values[k];
    if (v === undefined) continue;
    out[k] = [...(out[k] ?? []).filter((e) => e.date !== date), { date, value: v }].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return out;
}

/** チェックインの回ごとの値。資料に出てこなかった回は前の値を引き継いで updated=false。最初の値より前の回は出さない */
export function trendOf(entries: HistoryEntry[], checkins: Checkin[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  let carry: number | undefined;
  for (const c of [...checkins].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const e = entries.find((x) => x.date === c.date);
    if (e) {
      carry = e.value;
      out.push({ checkinId: c.id, date: c.date, value: e.value, updated: true });
    } else if (carry !== undefined) {
      out.push({ checkinId: c.id, date: c.date, value: carry, updated: false });
    }
  }
  return out;
}
