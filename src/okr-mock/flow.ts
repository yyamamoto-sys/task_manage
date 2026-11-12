// 流れの図（仕事 → KR → 目標）の集計と配置。画面には依存しない純粋関数だけを置く。
import { isOpen, krIdsOfTask, type LinkCtx } from "./logic";
import type { Pj, Task } from "./types";

/** 仕事1件あたりの帯の太さ（px） */
export const UNIT = 5;
export const PJ_MIN = 40;
export const KR_MIN = 112;
export const O_MIN = 170;
export const NODE_GAP = 12;
export const KR_GAP = 28;
export const ROW_H = 22;
export const PERSONAL_H = 48;
export const WIDTH = 1000;

export type FlowScope = "team" | "self";

export interface EdgeCount {
  pjId: string;
  krId: string;
  /** 終えた仕事の件数（このPJからこのKRへ） */
  done: number;
  open: number;
  /** そのうち本人の分 */
  mineDone: number;
  mineOpen: number;
  taskIds: string[];
}

export interface FlowCounts {
  edges: EdgeCount[];
  /** どのKRにもつながらない仕事 */
  loose: Task[];
  /** PJごとの、KRにつながる仕事（1件は1回） */
  linkedByPj: Record<string, Task[]>;
}

/**
 * PJ→KRの帯の件数を数える。
 * ・帯の太さ＝終えた仕事の件数、未完了分は同じ帯の薄い部分
 * ・共有PJの仕事は複数のKRへ帯が分かれる（各KRには1回ずつ）。PJの件数・全体の合計では1回に数える
 * ・scope が self のときは本人の仕事だけを数える
 */
export function flowCounts(args: { tasks: Task[]; pjs: Pj[]; ctx: LinkCtx; ownerId: string; scope: FlowScope }): FlowCounts {
  const { tasks, pjs, ctx, ownerId, scope } = args;
  const scoped = scope === "self" ? tasks.filter((t) => t.assigneeId === ownerId) : tasks;
  const edgeMap = new Map<string, EdgeCount>();
  const linkedByPj: Record<string, Task[]> = {};
  const loose: Task[] = [];
  for (const pj of pjs) {
    for (const t of scoped.filter((x) => x.pjId === pj.id)) {
      const krs = krIdsOfTask(t, ctx);
      if (krs.length === 0) {
        loose.push(t);
        continue;
      }
      (linkedByPj[pj.id] ??= []).push(t);
      const mine = t.assigneeId === ownerId;
      const done = t.status === "完了";
      for (const k of krs) {
        const key = `${pj.id}>${k}`;
        const e = edgeMap.get(key) ?? { pjId: pj.id, krId: k, done: 0, open: 0, mineDone: 0, mineOpen: 0, taskIds: [] };
        if (done) {
          e.done++;
          if (mine) e.mineDone++;
        } else {
          e.open++;
          if (mine) e.mineOpen++;
        }
        e.taskIds.push(t.id);
        edgeMap.set(key, e);
      }
    }
  }
  return { edges: [...edgeMap.values()], loose, linkedByPj };
}

export type SegKind = "doneMine" | "doneOther" | "openMine" | "openOther";

export interface BandSeg {
  kind: SegKind;
  count: number;
  offset: number;
  thickness: number;
}

/** 帯の中の区切り。上から 本人の完了／他の人の完了／本人の未完了／他の人の未完了 */
export function bandSegments(c: { done: number; open: number; mineDone: number; mineOpen: number }): BandSeg[] {
  const parts: [SegKind, number][] = [
    ["doneMine", c.mineDone],
    ["doneOther", c.done - c.mineDone],
    ["openMine", c.mineOpen],
    ["openOther", c.open - c.mineOpen],
  ];
  let offset = 0;
  const out: BandSeg[] = [];
  for (const [kind, count] of parts) {
    if (count <= 0) continue;
    const thickness = count * UNIT;
    out.push({ kind, count, offset, thickness });
    offset += thickness;
  }
  return out;
}

export interface Ribbon {
  id: string;
  fromId: string;
  toId: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  width: number;
  done: number;
  open: number;
  mineDone: number;
  mineOpen: number;
  segments: BandSeg[];
}

export interface PjGeo {
  pjId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** PJの件数（共有PJでも1回） */
  done: number;
  open: number;
  expanded: boolean;
  rows: { taskId: string; y: number }[];
}

export interface KrGeo {
  krId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  done: number;
  open: number;
  mineDone: number;
  mineOpen: number;
}

export interface OGeo {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 重複を除いた全体の件数 */
  done: number;
  open: number;
}

export interface LooseGeo {
  taskId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PersonalGeo {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowLayout {
  width: number;
  height: number;
  cols: { personal: { x: number; w: number }; pj: { x: number; w: number }; kr: { x: number; w: number }; o: { x: number; w: number } };
  pjNodes: PjGeo[];
  krNodes: KrGeo[];
  o: OGeo;
  pjKr: Ribbon[];
  krO: Ribbon[];
  loose: LooseGeo[];
  looseTop: number;
  personal: PersonalGeo[];
}

export function layoutFlow(args: {
  counts: FlowCounts;
  krIds: string[];
  /** 左端に個人OKRの列を出すとき、その個人OKRのID */
  personalIds: string[];
  expanded: string[];
}): FlowLayout {
  const { counts, krIds, personalIds, expanded } = args;
  const withPersonal = personalIds.length > 0;
  const cols = {
    personal: { x: 0, w: 150 },
    pj: withPersonal ? { x: 196, w: 214 } : { x: 0, w: 250 },
    kr: { x: 590, w: 250 },
    o: { x: 890, w: 110 },
  };
  const edgeW = (e: EdgeCount) => (e.done + e.open) * UNIT;
  const krIndex = (k: string) => krIds.indexOf(k);

  // PJノード：主なつなぎ先のKR順に並べて、帯の交差を減らす
  const pjIds = [...new Set(counts.edges.map((e) => e.pjId))];
  const primary = (pjId: string) => Math.min(...counts.edges.filter((e) => e.pjId === pjId).map((e) => krIndex(e.krId)));
  pjIds.sort((a, b) => primary(a) - primary(b));

  let cursor = 0;
  const pjNodes: PjGeo[] = pjIds.map((pjId) => {
    const edges = counts.edges.filter((e) => e.pjId === pjId);
    const sum = edges.reduce((s, e) => s + edgeW(e), 0);
    const h = Math.max(PJ_MIN, sum);
    const linked = counts.linkedByPj[pjId] ?? [];
    const isExp = expanded.includes(pjId);
    const rows = isExp ? linked.map((t, i) => ({ taskId: t.id, y: cursor + h + 6 + i * ROW_H })) : [];
    const node: PjGeo = {
      pjId,
      x: cols.pj.x,
      y: cursor,
      w: cols.pj.w,
      h,
      done: linked.filter((t) => t.status === "完了").length,
      open: linked.filter(isOpen).length,
      expanded: isExp,
      rows,
    };
    cursor += h + (isExp ? 6 + linked.length * ROW_H : 0) + NODE_GAP;
    return node;
  });
  const pjBottom = Math.max(0, cursor - NODE_GAP);
  const pjOf = (id: string) => pjNodes.find((n) => n.pjId === id)!;

  // KRノード：つながるPJの中心に寄せ、KRの順は固定
  const krNodes: KrGeo[] = [];
  let krCursor = 0;
  for (const k of krIds) {
    const edges = counts.edges.filter((e) => e.krId === k);
    const sum = edges.reduce((s, e) => s + edgeW(e), 0);
    const h = Math.max(KR_MIN, sum);
    let desired = krCursor;
    if (sum > 0) {
      const center = edges.reduce((s, e) => s + edgeW(e) * (pjOf(e.pjId).y + pjOf(e.pjId).h / 2), 0) / sum;
      desired = center - h / 2;
    }
    const y = Math.max(desired, krCursor, 0);
    krNodes.push({
      krId: k,
      x: cols.kr.x,
      y,
      w: cols.kr.w,
      h,
      done: edges.reduce((s, e) => s + e.done, 0),
      open: edges.reduce((s, e) => s + e.open, 0),
      mineDone: edges.reduce((s, e) => s + e.mineDone, 0),
      mineOpen: edges.reduce((s, e) => s + e.mineOpen, 0),
    });
    krCursor = y + h + KR_GAP;
  }
  const krBottom = Math.max(0, krCursor - KR_GAP);

  // 全体（O）
  const krTotals = krNodes.map((n) => (n.done + n.open) * UNIT);
  const krSum = krTotals.reduce((s, v) => s + v, 0);
  const oH = Math.max(O_MIN, krSum);
  const centers = krNodes.map((n) => n.y + n.h / 2);
  const oCenter = centers.length ? centers.reduce((s, v) => s + v, 0) / centers.length : oH / 2;
  const oY = Math.max(0, oCenter - oH / 2);
  const uniq = Object.values(counts.linkedByPj).flat();
  const o: OGeo = {
    x: cols.o.x,
    y: oY,
    w: cols.o.w,
    h: oH,
    done: uniq.filter((t) => t.status === "完了").length,
    open: uniq.filter(isOpen).length,
  };

  // PJ→KRの帯
  const pjKr: Ribbon[] = [];
  for (const pn of pjNodes) {
    const edges = counts.edges.filter((e) => e.pjId === pn.pjId).sort((a, b) => krIndex(a.krId) - krIndex(b.krId));
    const total = edges.reduce((s, e) => s + edgeW(e), 0);
    let sy = pn.y + (pn.h - total) / 2;
    for (const e of edges) {
      const kn = krNodes.find((n) => n.krId === e.krId)!;
      const incoming = counts.edges
        .filter((x) => x.krId === e.krId)
        .sort((a, b) => pjOf(a.pjId).y - pjOf(b.pjId).y);
      const inSum = incoming.reduce((s, x) => s + edgeW(x), 0);
      let before = 0;
      for (const x of incoming) {
        if (x === e) break;
        before += edgeW(x);
      }
      const w = edgeW(e);
      pjKr.push({
        id: `${e.pjId}>${e.krId}`,
        fromId: e.pjId,
        toId: e.krId,
        sx: pn.x + pn.w,
        sy,
        tx: kn.x,
        ty: kn.y + (kn.h - inSum) / 2 + before,
        width: w,
        done: e.done,
        open: e.open,
        mineDone: e.mineDone,
        mineOpen: e.mineOpen,
        segments: bandSegments(e),
      });
      sy += w;
    }
  }

  // KR→全体の帯
  const krO: Ribbon[] = [];
  let ty = o.y + (o.h - krSum) / 2;
  for (const kn of krNodes) {
    const w = (kn.done + kn.open) * UNIT;
    if (w > 0) {
      krO.push({
        id: `${kn.krId}>obj`,
        fromId: kn.krId,
        toId: "obj",
        sx: kn.x + kn.w,
        sy: kn.y + (kn.h - w) / 2,
        tx: o.x,
        ty,
        width: w,
        done: kn.done,
        open: kn.open,
        mineDone: kn.mineDone,
        mineOpen: kn.mineOpen,
        segments: bandSegments(kn),
      });
    }
    ty += w;
  }

  // 個人OKRの列（自分の表示のときだけ）
  const personal: PersonalGeo[] = personalIds.map((id, i) => ({ id, x: cols.personal.x, y: 4 + i * (PERSONAL_H + 18), w: cols.personal.w, h: PERSONAL_H }));
  const personalBottom = personal.length ? personal[personal.length - 1].y + PERSONAL_H : 0;

  // つながらない仕事：下に点線で置く
  const mainBottom = Math.max(pjBottom, krBottom, o.y + o.h, personalBottom);
  const looseTop = mainBottom + 40;
  const loose: LooseGeo[] = counts.loose.map((t, i) => ({ taskId: t.id, x: 0, y: looseTop + 26 + i * (ROW_H + 4), w: cols.pj.x + cols.pj.w, h: ROW_H }));
  const height = (loose.length ? loose[loose.length - 1].y + ROW_H : mainBottom) + 16;

  return { width: WIDTH, height, cols, pjNodes, krNodes, o, pjKr, krO, loose, looseTop, personal };
}

/** 帯を描くパス（左→右のなだらかな曲線で囲んだ帯）。thickness 分だけ下にずらした側も含む */
export function ribbonPath(r: { sx: number; sy: number; tx: number; ty: number }, offset: number, thickness: number): string {
  const mx = (r.sx + r.tx) / 2;
  const a = r.sy + offset;
  const b = r.ty + offset;
  return `M ${r.sx} ${a} C ${mx} ${a}, ${mx} ${b}, ${r.tx} ${b} L ${r.tx} ${b + thickness} C ${mx} ${b + thickness}, ${mx} ${a + thickness}, ${r.sx} ${a + thickness} Z`;
}
