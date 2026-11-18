// Kintone の OKR（PDF・テキスト）の読み取り結果を、地図の突き合わせ（KintoneRow）と「Kintone に合わせる」の書き込み計画に変える純粋関数。
// 読み取りは lib/ai/okrImportExtractor.ts（okr-import）を withBands で流用する。s91 91-3。
//
// 対応づけ：KR は並び順（Kintone の n 番目の KR ＝ アプリの KRn）。TF は番号（TF{KR番号}-{tf_number}）。
// アプリに対応する KR が無い TF は取り込めない（skipped）。アプリにだけある TF は消さない（期中の PJ の紐づけを壊さないため）。
import type { OkrImportAnalysis } from "../../../lib/ai/okrImportExtractor";
import type { KeyResult, Objective, Quarter, TaskForce } from "../../../lib/localData/types";
import type { KintoneRow, KrBands, KrDef, OkrItem } from "./types";

export const NEW_TF_PREFIX = "kintone-new:";

export interface KintoneTfNew {
  krId: string;
  tfNumber: string;
  name: string;
  description: string | null;
  background: string | null;
}

export interface KintoneReading {
  fileName: string;
  objective: { title: string; purpose: string | null; background: string | null };
  /** Kintone の KR（並び順）。krId はアプリの対応する KR（無ければ null） */
  krs: { krId: string | null; label: string; title: string; bands: KrBands | null }[];
  /** 今期のTFの突き合わせに使う行。アプリに無いTFの id は NEW_TF_PREFIX で始まる */
  rows: KintoneRow[];
  newTfs: Record<string, KintoneTfNew>;
  /** アプリに対応する KR が無いため取り込めない TF（表示用のラベル） */
  skipped: string[];
}

function toBands(b: Partial<Record<string, string>> | null | undefined): KrBands | null {
  if (!b) return null;
  const v = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  if (![60, 70, 80, 90, 100].some((k) => v(String(k)))) return null;
  const out: KrBands = { 60: v("60"), 70: v("70"), 80: v("80") };
  if (v("90")) out[90] = v("90");
  if (v("100")) out[100] = v("100");
  return out;
}

export function readingFromImport(a: OkrImportAnalysis, items: OkrItem[], fileName: string): KintoneReading {
  const appKrs = items.filter((i) => i.kind === "kr");
  const appTfs = items.filter((i) => i.kind === "tf");
  const rows: KintoneRow[] = [];
  const newTfs: Record<string, KintoneTfNew> = {};
  const skipped: string[] = [];
  const krs = a.key_results.map((k, i) => {
    const app = appKrs[i];
    const label = `KR${i + 1}`;
    k.task_forces.forEach((tf, j) => {
      const num = (tf.tf_number ?? "").trim() || String(j + 1);
      const tfLabel = `TF${i + 1}-${num}`;
      if (!app) {
        skipped.push(`${tfLabel} ${tf.name}`);
        return;
      }
      const cur = appTfs.find((x) => x.label === tfLabel && x.parentId === app.id);
      const id = cur ? cur.id : `${NEW_TF_PREFIX}${tfLabel}`;
      if (rows.some((r) => r.id === id)) return;
      rows.push({ id, label: tfLabel, text: tf.name.trim(), parentId: app.id });
      if (!cur) newTfs[id] = { krId: app.id, tfNumber: num, name: tf.name.trim(), description: tf.description, background: tf.background };
    });
    return { krId: app?.id ?? null, label, title: k.title.trim(), bands: toBands(k.bands) };
  });
  return {
    fileName,
    objective: { title: a.objective.title.trim(), purpose: a.objective.purpose, background: a.objective.background },
    krs,
    rows,
    newTfs,
    skipped,
  };
}

export interface KintoneApplyPlan {
  objective: KintoneReading["objective"];
  krTitles: { krId: string; title: string }[];
  tfRenames: { tfId: string; name: string }[];
  tfCreates: KintoneTfNew[];
  bands: { krId: string; bands: KrBands }[];
}

const sameBands = (a: KrBands, b: KrBands) => [60, 70, 80, 90, 100].every((k) => (a[k as 60] ?? "") === (b[k as 60] ?? ""));

/** KR ごとに、何を Kintone に合わせるか（利用者が選ぶ）。未指定は「違うものはすべて合わせる」 */
export interface KintoneKrChoice {
  titles: string[];
  bands: string[];
}

/** Kintone と アプリの KR の件数が違うか（並び順で対応づけるので、違うときは合わせない） */
export function krCountMismatch(r: KintoneReading, items: OkrItem[]): { kintone: number; app: number } | null {
  const app = items.filter((i) => i.kind === "kr").length;
  return r.krs.length === app ? null : { kintone: r.krs.length, app };
}

/** KR ごとの題名と段の基準文の旧／新（画面で並べて見せ、合わせるものを選ばせる）。違うものだけ */
export function krChanges(r: KintoneReading, items: OkrItem[], krDefs: Record<string, KrDef>) {
  return r.krs.flatMap((k) => {
    const cur = k.krId ? items.find((i) => i.id === k.krId) : undefined;
    if (!k.krId || !cur) return [];
    const titleChanged = !!k.title && cur.text !== k.title;
    const oldBands = krDefs[k.krId]?.bands ?? null;
    const bandsChanged = !!k.bands && !(oldBands && sameBands(oldBands, k.bands));
    return titleChanged || bandsChanged ? [{ krId: k.krId, label: k.label, oldTitle: cur.text, newTitle: k.title, titleChanged, oldBands, newBands: k.bands, bandsChanged }] : [];
  });
}

/** 「Kintone に合わせる」で書くもの。アプリといまの内容が同じものは書かない。KR の題名・段の基準文は選んだものだけ */
export function planKintoneApply(r: KintoneReading, items: OkrItem[], krDefs: Record<string, KrDef>, choice?: KintoneKrChoice): KintoneApplyPlan {
  const byId = new Map(items.map((i) => [i.id, i]));
  const pickTitle = (krId: string) => !choice || choice.titles.includes(krId);
  const pickBands = (krId: string) => !choice || choice.bands.includes(krId);
  return {
    objective: r.objective,
    krTitles: r.krs.flatMap((k) => (k.krId && k.title && byId.get(k.krId)?.text !== k.title && pickTitle(k.krId) ? [{ krId: k.krId, title: k.title }] : [])),
    tfRenames: r.rows.flatMap((row) => {
      const cur = byId.get(row.id);
      return cur && cur.text !== row.text ? [{ tfId: row.id, name: row.text }] : [];
    }),
    tfCreates: r.rows.flatMap((row) => (r.newTfs[row.id] ? [r.newTfs[row.id]] : [])),
    bands: r.krs.flatMap((k) => {
      if (!k.krId || !k.bands || !pickBands(k.krId)) return [];
      const cur = krDefs[k.krId];
      return cur && sameBands(cur.bands, k.bands) ? [] : [{ krId: k.krId, bands: k.bands }];
    }),
  };
}

export interface KintoneWriteDeps {
  objective: Objective | null;
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  saveObjective: (o: Objective) => Promise<void>;
  saveKeyResult: (k: KeyResult) => Promise<void>;
  saveTaskForce: (t: TaskForce) => Promise<void>;
  viewerId: string;
  quarter: Quarter;
  now: string;
  newId: () => string;
}

/** 「Kintone に合わせる」：O・KR・TF 本体を既存の保存関数（appStore）で書く。段の基準文とロックは呼び出し側（repository） */
export async function writeKintonePlan(plan: KintoneApplyPlan, d: KintoneWriteDeps): Promise<void> {
  const o = d.objective;
  if (o) {
    const next: Objective = {
      ...o,
      title: plan.objective.title || o.title,
      purpose: plan.objective.purpose ?? o.purpose,
      background: plan.objective.background ?? o.background,
    };
    if (next.title !== o.title || next.purpose !== o.purpose || next.background !== o.background) await d.saveObjective({ ...next, updated_by: d.viewerId });
  }
  for (const k of plan.krTitles) {
    const cur = d.keyResults.find((x) => x.id === k.krId);
    if (cur) await d.saveKeyResult({ ...cur, title: k.title, updated_by: d.viewerId });
  }
  for (const t of plan.tfRenames) {
    const cur = d.taskForces.find((x) => x.id === t.tfId);
    if (cur) await d.saveTaskForce({ ...cur, name: t.name, updated_by: d.viewerId });
  }
  for (const t of plan.tfCreates) {
    await d.saveTaskForce({
      id: d.newId(),
      kr_id: t.krId,
      tf_number: t.tfNumber,
      quarter: d.quarter,
      name: t.name,
      description: t.description ?? null,
      background: t.background ?? null,
      leader_member_id: null,
      is_deleted: false,
      created_at: d.now,
      updated_at: d.now,
      updated_by: d.viewerId,
    });
  }
}

/** O・KR の文言の違い（画面の表示用） */
export function headDiffs(r: KintoneReading, items: OkrItem[]): { label: string; app: string; kintone: string }[] {
  const out: { label: string; app: string; kintone: string }[] = [];
  const o = items.find((i) => i.kind === "objective");
  if (o && r.objective.title && o.text !== r.objective.title) out.push({ label: "O", app: o.text, kintone: r.objective.title });
  for (const k of r.krs) {
    const cur = k.krId ? items.find((i) => i.id === k.krId) : undefined;
    if (!cur) out.push({ label: k.label, app: "", kintone: k.title });
    else if (cur.text !== k.title) out.push({ label: k.label, app: cur.text, kintone: k.title });
  }
  return out;
}
