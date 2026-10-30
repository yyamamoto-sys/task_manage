// src/lib/wbsImport/wbsMspdi.ts
//
// 【設計意図・v3.198】
// MS Project XML（MSPDI。ProjectLibre・GanttProject が書き出す「MS Project XML」も同形式）を WbsItem にする純粋関数。
// - タスク：UID=0（プロジェクト要約）・IsNull=1・名前が空の行は除く。階層は OutlineLevel（1始まり）＋出現順。
// - 日付は Start／Finish の先頭10文字（日付部分）だけ。Milestone=1→マイルストーン。
// - 状態：PercentComplete 100→done／1〜99→in_progress／0→todo。
// - 依存：PredecessorLink の Type 0=FF・1=FS・2=SF・3=SS。ラグは LinkLag（1/10分単位）を暦日へ換算する。
//   LagFormat（時間単位。MS Project XML 仕様の DurationFormat と同じ列挙）が経過時間系なら 1日=1440分、
//   それ以外（稼働時間）は 1日=MinutesPerDay（Project 要素。無ければ MS Project 既定の 480）。四捨五入。
//   経過時間系の値の根拠：MS の DurationFormat は 3=m・4=em・5=h・6=eh・7=d・8=ed・9=w・10=ew・11=mo・12=emo・13=%・14=e%・15=null、
//   見積り（estimated）版は 32 を足した値（35〜）。偶数が経過時間（elapsed）。公式スキーマ（learn.microsoft.com の
//   office-project xml-data-interchange・DurationFormat／LinkLag の各ページ）の表に基づく。パーセント系（13・14）は
//   「先行の期間に対する割合」で日数にできないため、ずらしなしで取り込んで警告する。
// - 担当者：Assignment の TaskUID・ResourceUID から Resource の Name を引き、複数ならカンマでつなぐ
//   （照合は wbsPlan.resolveAssignees。照合できない名前は警告して外す。現行の担当者列と同じ扱い）。

import { normalizeLag, type DepType } from "../dependencies/depType";
import type { WbsItem } from "./wbsItems";
import { parseWbsStatus } from "./wbsItems";
import { childText, childrenNamed, parseXml } from "./miniXml";
import { parseWbsDate } from "./wbsParse";
import type { PredSpec } from "./wbsPredecessors";

export const DEFAULT_MINUTES_PER_DAY = 480;
const ELAPSED_MINUTES_PER_DAY = 1440;

const TYPE_BY_CODE: Record<string, DepType> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };

/** LagFormat が経過時間系か（偶数の 4〜14、見積り版は 32 を引いて同様） */
export function isElapsedLagFormat(code: number): boolean {
  const base = code >= 35 ? code - 32 : code;
  return base >= 4 && base <= 14 && base % 2 === 0;
}

function isPercentLagFormat(code: number): boolean {
  const base = code >= 35 ? code - 32 : code;
  return base === 13 || base === 14;
}

export interface MspdiResult {
  title: string | null;
  items: WbsItem[];
  warnings: string[];
}

export type MspdiOutcome = { ok: true; result: MspdiResult } | { ok: false; error: string };

export function parseMspdi(xml: string): MspdiOutcome {
  let root;
  try {
    root = parseXml(xml);
  } catch (e) {
    return { ok: false, error: `XML として読み取れませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。` };
  }
  if (root.name !== "Project") {
    return { ok: false, error: "MS Project の XML（<Project> から始まるファイル）ではありません。MS Project・ProjectLibre・GanttProject で「MS Project XML」形式で書き出したファイルを選んでください。" };
  }
  const warnings: string[] = [];
  const title = childText(root, "Title") || childText(root, "Name") || null;
  const mpd = Number(childText(root, "MinutesPerDay"));
  const minutesPerDay = Number.isFinite(mpd) && mpd > 0 ? mpd : DEFAULT_MINUTES_PER_DAY;

  const resourceName = new Map<string, string>();
  for (const res of childrenNamed(root, "Resources").flatMap(r => childrenNamed(r, "Resource"))) {
    const name = childText(res, "Name");
    if (name !== "") resourceName.set(childText(res, "UID"), name);
  }
  const assignees = new Map<string, string[]>();
  for (const a of childrenNamed(root, "Assignments").flatMap(r => childrenNamed(r, "Assignment"))) {
    const name = resourceName.get(childText(a, "ResourceUID"));
    if (!name) continue;
    const tuid = childText(a, "TaskUID");
    const list = assignees.get(tuid) ?? [];
    if (!list.includes(name)) list.push(name);
    assignees.set(tuid, list);
  }

  const taskNodes = childrenNamed(root, "Tasks").flatMap(t => childrenNamed(t, "Task"));
  const items: WbsItem[] = [];
  let fractionalLags = 0;
  let percentLags = 0;
  taskNodes.forEach((t, k) => {
    const uid = childText(t, "UID");
    if (uid === "0" || childText(t, "IsNull") === "1") return;
    const name = childText(t, "Name");
    if (name === "") return;
    const warns: string[] = [];
    const level = Number(childText(t, "OutlineLevel"));
    const startP = parseWbsDate(childText(t, "Start").slice(0, 10));
    const endP = parseWbsDate(childText(t, "Finish").slice(0, 10));
    if (startP.invalid) warns.push("開始日を日付として読めません（日付なしで取り込みます）");
    if (endP.invalid) warns.push("終了日を日付として読めません（日付なしで取り込みます）");

    const predSpecs: PredSpec[] = [];
    for (const l of childrenNamed(t, "PredecessorLink")) {
      if (childText(l, "CrossProject") === "1") { warns.push("別のプロジェクトへの先行は取り込みません"); continue; }
      const pid = childText(l, "PredecessorUID");
      if (pid === "") continue;
      const code = childText(l, "Type");
      const type = TYPE_BY_CODE[code === "" ? "1" : code] ?? "FS";
      const rawLag = Number(childText(l, "LinkLag"));
      let lagDays = 0;
      let note: string | undefined;
      if (Number.isFinite(rawLag) && rawLag !== 0) {
        const fmt = Number(childText(l, "LagFormat"));
        if (Number.isFinite(fmt) && isPercentLagFormat(fmt)) {
          percentLags++;
          note = "ずらしが先行の期間に対する割合のため、ずらしなしで取り込みました";
        } else {
          const perDay = Number.isFinite(fmt) && isElapsedLagFormat(fmt) ? ELAPSED_MINUTES_PER_DAY : minutesPerDay;
          const days = rawLag / 10 / perDay;
          lagDays = normalizeLag(Math.round(days)) || 0;
          if (!Number.isInteger(days)) { fractionalLags++; note = "ずらし日数の端数を四捨五入しました"; }
        }
      }
      predSpecs.push({ id: pid, type, lagDays, note });
    }

    const pct = Number(childText(t, "PercentComplete"));
    items.push({
      sourceRow: k + 1,
      id: uid,
      name,
      depth: Number.isFinite(level) && level >= 1 ? level - 1 : 0,
      start: startP.value,
      end: endP.value,
      status: parseWbsStatus(Number.isFinite(pct) ? `${pct}%` : ""),
      milestone: childText(t, "Milestone") === "1",
      predecessorText: "",
      predSpecs,
      assigneeText: (assignees.get(uid) ?? []).join("、"),
      memo: childText(t, "Notes"),
      warnings: warns,
    });
  });
  if (fractionalLags > 0) warnings.push(`ずらし日数に端数が出た先行が${fractionalLags}件あります（四捨五入して日数にしました）。`);
  if (percentLags > 0) warnings.push(`ずらしが「先行の期間に対する割合」の先行が${percentLags}件あります（ずらしなしで取り込みました）。`);
  if (items.length === 0) return { ok: false, error: "XML の中に取り込めるタスクがありませんでした。" };
  return { ok: true, result: { title, items, warnings } };
}
