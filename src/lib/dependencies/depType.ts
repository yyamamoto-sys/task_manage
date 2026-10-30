// src/lib/dependencies/depType.ts
//
// 【設計意図・v3.197】依存関係の「種類（FS/SS/FF/SF）」と「ずらし日数（ラグ）」の共通定義。
// 将来の MS Project XML（MSPDI PredecessorLink：Type 0=FF,1=FS,2=SF,3=SS／LinkLag）取り込みの土台。
// - 列が無い旧データ・マイグレーション未適用のDBの行は dep_type / lag_days が undefined になる。
//   必ずこのファイルの depTypeOf / lagOf を通して読み、未設定は FS／0 として扱う。
// - ラグの単位は暦日（reschedule.ts が従来から土日祝を飛ばさない暦日計算のため、それに合わせる）。
//   負の値＝リード（先行の完了／開始より前から始められる）。

import type { TaskDependency } from "../localData/types";

export type DepType = "FS" | "SS" | "FF" | "SF";

export const DEP_TYPES: DepType[] = ["FS", "SS", "FF", "SF"];

export const DEP_TYPE_LABELS: Record<DepType, string> = {
  FS: "終了→開始（FS）",
  SS: "開始→開始（SS）",
  FF: "終了→終了（FF）",
  SF: "開始→終了（SF）",
};

/** ラグの入力上限（誤入力で桁違いの日付にならないための安全網） */
export const MAX_LAG_DAYS = 3650;

type DepLike = Pick<TaskDependency, "dep_type" | "lag_days">;

export function depTypeOf(d: DepLike): DepType {
  const t = d.dep_type;
  return t === "SS" || t === "FF" || t === "SF" ? t : "FS";
}

export function lagOf(d: DepLike): number {
  const n = d.lag_days;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** 入力値（文字列・数値）を整数ラグに正規化する。不正値は 0。 */
export function normalizeLag(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_LAG_DAYS, Math.min(MAX_LAG_DAYS, Math.trunc(n)));
}

/** "SS+2d" / "FF-1d"。FS かつラグ0（既定）は null（ラベルを出さない）。 */
export function formatDepLabel(d: DepLike): string | null {
  const type = depTypeOf(d);
  const lag = lagOf(d);
  if (type === "FS" && lag === 0) return null;
  return `${type}${lag > 0 ? `+${lag}d` : lag < 0 ? `${lag}d` : ""}`;
}

/** 常に出す版（"FS" / "SS+2d"）。CSV 等のエクスポート・編集 UI の説明用。 */
export function formatDepLabelAlways(d: DepLike): string {
  return formatDepLabel(d) ?? "FS";
}

/** 依存の「基準側の日付」が先行の start/due のどちらか */
export function predecessorAnchor(type: DepType): "start" | "due" {
  return type === "SS" || type === "SF" ? "start" : "due";
}

/** 依存の「制約を受ける側の日付」が後続の start/due のどちらか */
export function successorAnchor(type: DepType): "start" | "due" {
  return type === "FS" || type === "SS" ? "start" : "due";
}

/**
 * 完了を止める（ハードゲート）依存か。先行が「終わる」ことを待つ FS・FF のみ。
 * SS・SF は先行の開始を基準にするだけで、先行の完了は待たない。
 */
export function blocksCompletion(d: DepLike): boolean {
  const t = depTypeOf(d);
  return t === "FS" || t === "FF";
}

/** 着手（todo→進行中）のソフト警告の対象か。後続の開始が先行の終了に縛られる FS のみ。 */
export function blocksStart(d: DepLike): boolean {
  return depTypeOf(d) === "FS";
}
