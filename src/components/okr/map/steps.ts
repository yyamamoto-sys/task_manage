// 達成度の「段」（60から登る）まわりの純粋関数。画面には依存しない。
// 見立ては資料の記述だけから決まる（タスクの完了率は使わない）。段の良し悪しを色や語で決めつけない。
import type { AssessEntry, Assessment, BasisItem, Checkin, KrBands, Learning } from "./types";

export const ALL_STEPS = [60, 70, 80, 90, 100] as const;

/** そのKRが持つ段（昇順）。60は必ずある */
export function stepsOf(bands: KrBands): number[] {
  return [...ALL_STEPS].filter((s) => s === 60 || bands[s] !== undefined);
}

export function maxStep(bands: KrBands): number {
  const s = stepsOf(bands);
  return s[s.length - 1];
}

/** 見立ての値を 60〜最上段の整数にそろえる（60未満にはしない・定義された最上段を超えない） */
export function clampAssessment(value: number, bands: KrBands): number {
  const n = Math.round(Number.isFinite(value) ? value : 60);
  return Math.min(maxStep(bands), Math.max(60, n));
}

/** 今の値より上にある、最も近い段。最上段にいるなら null */
export function nextStep(value: number, bands: KrBands): number | null {
  return stepsOf(bands).find((s) => s > value) ?? null;
}

/** 今の値以下にある、最も高い段（いま立っている段） */
export function stepBelow(value: number, bands: KrBands): number {
  const list = stepsOf(bands).filter((s) => s <= value);
  return list.length ? list[list.length - 1] : 60;
}

/** 90・100 の段を持つKR（これまでのやり方を超える目標を置いている） */
export function hasStretch(bands: KrBands): boolean {
  return bands[90] !== undefined || bands[100] !== undefined;
}

export interface NextRequirements {
  step: number;
  items: BasisItem[];
  /** 「確認できた」でないもの（一部・まだ） */
  pending: BasisItem[];
}

/** 次の段の要件。最上段にいるときは null */
export function nextRequirements(a: Assessment, bands: KrBands): NextRequirements | null {
  const step = nextStep(a.value, bands);
  if (step === null) return null;
  return { step, items: a.basis, pending: a.basis.filter((b) => b.status !== "確認できた") };
}

/** 「70 まで：◯◯が確認できれば」の1行。最上段にいるときは最上段の旨 */
export function nextLine(a: Assessment, bands: KrBands): string {
  const nr = nextRequirements(a, bands);
  if (!nr) return "いちばん上の段にいます";
  if (nr.items.length === 0) return `${nr.step} まで：要件の整理はこれからです`;
  if (nr.pending.length === 0) return `${nr.step} まで：要件はすべて確認できています`;
  return `${nr.step} まで：${nr.pending.map((p) => p.requirement).join("、")}が確認できれば`;
}

/** 次の段の要件のうち、まだ／一部のものがあるか */
export function hasPending(a: Assessment, bands: KrBands): boolean {
  const nr = nextRequirements(a, bands);
  return !!nr && nr.pending.length > 0;
}

// ---------- 回ごとの見立て ----------

/**
 * 回ごとに1つの見立てにまとめる。同じ回に資料が複数あるときは、値の高い方（同値なら後に入れた方）。
 * 日付の古い順
 */
export function effectiveEntries(entries: AssessEntry[]): AssessEntry[] {
  const by = new Map<string, AssessEntry>();
  for (const e of entries) {
    const cur = by.get(e.checkinId);
    if (!cur || e.assessment.value >= cur.assessment.value) by.set(e.checkinId, e);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface CurrentAssessment {
  cur: AssessEntry;
  prev: AssessEntry | null;
}

export function currentAssessment(entries: AssessEntry[]): CurrentAssessment | null {
  const eff = effectiveEntries(entries);
  if (eff.length === 0) return null;
  return { cur: eff[eff.length - 1], prev: eff.length > 1 ? eff[eff.length - 2] : null };
}

/** 前回からの段の位置の差。前回が無いときは null */
export function stepMove(ca: CurrentAssessment): number | null {
  return ca.prev ? ca.cur.assessment.value - ca.prev.assessment.value : null;
}

/** 「+3」「変わらず」。色で良し悪しを付けない事実の表記 */
export function moveText(n: number | null): string {
  if (n === null) return "前回なし";
  if (n === 0) return "変わらず";
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}`;
}

/** 確定の前後の増減の札（「＋2」）。動かなければ null */
export function deltaText(before: number, after: number): string | null {
  const n = after - before;
  return n === 0 ? null : `${n > 0 ? "＋" : "−"}${Math.abs(n)}`;
}

/** 確定の前後で越えた段（上向きに越えたもののうち最も高い）。越えていなければ null */
export function crossedStep(before: number, after: number, bands: KrBands): number | null {
  const crossed = stepsOf(bands).filter((s) => s > 60 && before < s && after >= s);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

// ---------- 学び・気づき ----------

/** 回の新しい順、同じ回の中は「分かったこと」→「次に試すこと」 */
export function learningsOfKr(list: Learning[], krId: string, checkins: Checkin[]): { checkin: Checkin; items: Learning[] }[] {
  const mine = list.filter((l) => l.krId === krId);
  return [...checkins]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((c) => ({
      checkin: c,
      items: mine.filter((l) => l.checkinId === c.id).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "分かったこと" ? -1 : 1)),
    }))
    .filter((g) => g.items.length > 0);
}

/** 主画面の「最近の学び」。新しい回から、最大 max 件 */
export function recentLearnings(list: Learning[], checkins: Checkin[], max = 3): Learning[] {
  const order = [...checkins].sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => c.id);
  return list
    .filter((l) => order.includes(l.checkinId))
    .sort((a, b) => order.indexOf(a.checkinId) - order.indexOf(b.checkinId) || (a.kind === b.kind ? 0 : a.kind === "分かったこと" ? -1 : 1))
    .slice(0, max);
}
