// src/lib/wbsImport/wbsPredecessors.ts
//
// 【設計意図・v3.198】
// 取り込みの先行タスク（依存）の読み取り。表記は「3」「3FS+2」「3SS-1d」「PRJ-12」。
// 種類省略＝FS、ラグ省略＝0（暦日。負＝リード）。種類が無くラグだけのときは「+2d」のように単位（d／日）を
// 必須にする（Jira のキー「PRJ-12」の「-12」をラグと取り違えないため）。
// 先に「トークン全体が既知のIDか」を見る（「BFS」のようなIDを「B＋FS」と誤読しないため）。

import { canAddDependency } from "../dependencies/cycleCheck";
import { normalizeLag, type DepType } from "../dependencies/depType";

export interface WbsPredecessor { id: string; type: DepType; lagDays: number }

/** 取り込み前の指定（IDは未照合）。MSPDI のように構造で持っているときはこれを直接渡す */
export interface PredSpec { id: string; type: DepType; lagDays: number; note?: string }

const WITH_TYPE = /^(.+?)\s*(FS|SS|FF|SF)\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(?:d|日|days?)?)?$/i;
const LAG_ONLY = /^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*(?:d|日|days?)$/i;

function lagFrom(sign: string | undefined, num: string | undefined): { lag: number; fractional: boolean } {
  if (!num) return { lag: 0, fractional: false };
  const n = Number(num);
  return { lag: normalizeLag(Math.round(sign === "-" ? -n : n)) || 0, fractional: !Number.isInteger(n) };
}

/** 1トークンを PredSpec にする。known は既知のID集合 */
function parseToken(token: string, known: (id: string) => boolean): PredSpec | null {
  const t = token.trim();
  if (t === "") return null;
  if (known(t)) return { id: t, type: "FS", lagDays: 0 };
  let m = WITH_TYPE.exec(t);
  if (m) {
    const { lag, fractional } = lagFrom(m[3], m[4]);
    return { id: m[1].trim(), type: m[2].toUpperCase() as DepType, lagDays: lag, note: fractional ? "ずらし日数の端数を四捨五入しました" : undefined };
  }
  m = LAG_ONLY.exec(t);
  if (m) {
    const { lag, fractional } = lagFrom(m[2], m[3]);
    return { id: m[1].trim(), type: "FS", lagDays: lag, note: fractional ? "ずらし日数の端数を四捨五入しました" : undefined };
  }
  return { id: t, type: "FS", lagDays: 0 };
}

/** 「,」「;」「、」「改行」で区切る。区切りの後でも読めない塊は空白でさらに分ける（旧テンプレートの「1.2 1.1.2」） */
export function parsePredecessorText(text: string, known: (id: string) => boolean): PredSpec[] {
  const out: PredSpec[] = [];
  for (const chunk of text.split(/[,、，;；\n]+/)) {
    const c = chunk.trim();
    if (c === "") continue;
    const whole = parseToken(c, known);
    if (whole && (known(whole.id) || !/\s/.test(c))) { out.push(whole); continue; }
    for (const part of c.split(/\s+/)) {
      const p = parseToken(part, known);
      if (p) out.push(p);
    }
  }
  return out;
}

export interface PredResolvable {
  id: string;
  isGroup: boolean;
  predecessorText: string;
  predSpecs?: PredSpec[];
  predecessors: WbsPredecessor[];
  predecessorIds: string[];
  warnings: string[];
}

/**
 * 先行タスクをIDで照合する。見つからない・グループ・自己参照・循環・重複は警告して読み飛ばす。
 * 同じ先行が種類違いで2回書かれたときは最初のものを使う（依存は先行・後続の組に1本のため）。
 */
export function resolvePredecessors(rows: PredResolvable[]): void {
  const idToIndex = new Map<string, number>();
  rows.forEach((r, i) => { if (!idToIndex.has(r.id)) idToIndex.set(r.id, i); });
  const known = (id: string) => idToIndex.has(id);
  const edges: { predecessor_task_id: string; successor_task_id: string }[] = [];
  for (const row of rows) {
    const specs = row.predSpecs ?? (row.predecessorText === "" ? [] : parsePredecessorText(row.predecessorText, known));
    if (specs.length === 0) continue;
    if (row.isGroup) {
      row.warnings.push("グループの先行タスクは取り込みません（グループはタスクではないため）");
      continue;
    }
    const seen = new Set<string>();
    for (const s of specs) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const pi = idToIndex.get(s.id);
      if (pi === undefined) { row.warnings.push(`先行タスクのID「${s.id}」が見つかりません（読み飛ばします）`); continue; }
      const pred = rows[pi];
      if (pred.isGroup) { row.warnings.push(`先行タスクのID「${s.id}」はグループのため読み飛ばします`); continue; }
      if (pred.id === row.id) { row.warnings.push("先行タスクが自分自身のため読み飛ばします"); continue; }
      if (!canAddDependency(edges, pred.id, row.id).ok) { row.warnings.push(`先行タスク「${s.id}」は循環になるため読み飛ばします`); continue; }
      if (s.note) row.warnings.push(`先行タスク「${s.id}」：${s.note}`);
      edges.push({ predecessor_task_id: pred.id, successor_task_id: row.id });
      row.predecessors.push({ id: s.id, type: s.type, lagDays: s.lagDays });
      row.predecessorIds.push(s.id);
    }
  }
}
