// 資料の確定まわりの純粋関数（決定事項の足し合わせ・資料どうしの食い違い）
import type { Band, Checkin, Conflict, Decision, Draft, KrRecord, Resource } from "./types";

/**
 * 決定事項と宿題の反映。同じ回の資料を複数確定しても、資料ごとに足し合わせる（他の資料の分は消さない）。
 * 同じ資料を確定し直したときだけ、その資料の分を入れ替える
 */
export function mergeDecisions(prev: Decision[], selected: Resource[], ci: Checkin): Decision[] {
  const ids = new Set(selected.map((r) => r.id));
  const kept = prev.filter((d) => !(d.checkinId === ci.id && d.resourceId !== undefined && ids.has(d.resourceId)));
  const added = selected.flatMap((res) => res.decisions.map((d, i) => ({ ...d, id: `${res.id}-${i}`, checkinId: ci.id, resourceId: res.id })));
  return [...kept, ...added];
}

/**
 * 同じKRに、資料どうし（またはその回にすでに確定した値）で違う値があるものを並べる。
 * すでに確定済みの値は、同じ回に確定され、いま選んでいる資料のどれからでもない出典のときだけ候補に入れる
 */
export function detectConflicts(selected: Resource[], records: Record<string, KrRecord>, checkinDate: string): Conflict[] {
  const byKr = new Map<string, Draft[]>();
  for (const res of selected) for (const d of res.drafts) byKr.set(d.krId, [...(byKr.get(d.krId) ?? []), d]);
  const out: Conflict[] = [];
  for (const [krId, drafts] of byKr) {
    const options = drafts.map((d) => ({ value: d.value, source: d.source, existing: false }));
    const r = records[krId];
    if (r && r.updatedAt === checkinDate && r.source && !drafts.some((d) => d.source.doc === r.source!.doc)) {
      options.push({ value: r.value as number | Band, source: r.source, existing: true });
    }
    const distinct = new Set(options.map((o) => o.value));
    if (distinct.size >= 2) out.push({ krId, options });
  }
  return out;
}

/** 食い違いの選択（KR → 候補の番号）を反映して、確定に使う下書きを1KR1件にそろえる */
export function mergeDrafts(selected: Resource[], conflicts: Conflict[], picks: Record<string, number>): Draft[] {
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const res of selected) {
    for (const d of res.drafts) {
      if (seen.has(d.krId)) continue;
      seen.add(d.krId);
      const c = conflicts.find((x) => x.krId === d.krId);
      const o = c ? c.options[picks[d.krId] ?? 0] : undefined;
      out.push(o ? { krId: d.krId, value: o.value, source: o.source } : d);
    }
  }
  return out;
}

export function unresolved(conflicts: Conflict[], picks: Record<string, number>): string[] {
  return conflicts.filter((c) => picks[c.krId] === undefined).map((c) => c.krId);
}
