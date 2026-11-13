// 地図（PJ → KR → O）の集計と配置。画面には依存しない純粋関数だけを置く。
// 帯の太さは「件数」ではなく「割合」。KRとOの高さは固定なので、仕事が何百件になっても図の大きさは変わらない。
import { inPeriod, isOpen, krIdsOfTask, PERSONAL_PJ, type LinkCtx } from "./logic";
import type { Task } from "./types";

export const PJ_MIN = 44;
export const KR_H = 124;
/** 1つのKRに流れ込む帯の太さの合計（各PJの帯は、そのKR向けの仕事件数に占める割合で分ける） */
export const KR_BAND = 100;
export const O_H = 190;
/** KRからOへ流れる帯の太さの合計 */
export const O_BAND = 120;
export const MIN_BAND = 10;
export const NODE_GAP = 12;
export const KR_GAP = 28;
export const ROW_H = 22;
export const PERSONAL_H = 48;
export const WIDTH = 1000;
/** PJが9以上のときは、件数の多い順にこの数だけ並べて、残りは「ほか◯PJ」にまとめる */
export const MAX_PJ = 8;
export const OTHER_PJ = "__other";
/** 帯のKR側の端から、KRノードまでの間（「仕事 完了 5／残り 3」を書く） */
export const LABEL_GAP = 140;
const LABEL_STEP = 13;

export type FlowScope = "team" | "self";

export interface EdgeCount {
  pjId: string;
  krId: string;
  /** 終えた仕事の件数（このPJからこのKRへ） */
  done: number;
  open: number;
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
 * ・今期の仕事だけ（完了は期の始め以降に終えたもの。未完了は常に対象）
 * ・共有PJの仕事は複数のKRへ帯が分かれる（各KRには1回ずつ）。PJの件数・全体の合計では1回に数える
 * ・PJに属さない個人の仕事も対象（まとめて1つのPJ扱い）
 * ・scope が self のときは本人の仕事だけを数える
 */
export function flowCounts(args: { tasks: Task[]; ctx: LinkCtx; ownerId: string; scope: FlowScope; periodStart: string }): FlowCounts {
  const { tasks, ctx, ownerId, scope, periodStart } = args;
  const scoped = tasks.filter((t) => inPeriod(t, periodStart) && (scope === "team" || t.assigneeId === ownerId));
  const edgeMap = new Map<string, EdgeCount>();
  const linkedByPj: Record<string, Task[]> = {};
  const loose: Task[] = [];
  for (const t of scoped) {
    const pjId = t.pjId || PERSONAL_PJ;
    const krs = krIdsOfTask(t, ctx);
    if (krs.length === 0) {
      loose.push(t);
      continue;
    }
    (linkedByPj[pjId] ??= []).push(t);
    const done = t.status === "完了";
    for (const k of krs) {
      const key = `${pjId}>${k}`;
      const e = edgeMap.get(key) ?? { pjId, krId: k, done: 0, open: 0, taskIds: [] };
      if (done) e.done++;
      else e.open++;
      e.taskIds.push(t.id);
      edgeMap.set(key, e);
    }
  }
  return { edges: [...edgeMap.values()], loose, linkedByPj };
}

/** 地図に出ている仕事のうち、結節点（2つ以上のKRにつながる仕事）のID。共有PJの仕事も1回 */
export function junctionIdsOf(counts: FlowCounts, ctx: LinkCtx): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(counts.linkedByPj)) for (const t of list) if (krIdsOfTask(t, ctx).length >= 2) ids.add(t.id);
  return ids;
}

/**
 * 合計 total を件数の割合で分ける。細くなりすぎる帯は min に固定し、残りを割合で分け直す（合計は total のまま）。
 * 帯の数が多すぎて min を並べても total に収まらないときは、均等に分ける
 */
export function proportionalWidths(counts: number[], total: number, min: number): number[] {
  const n = counts.length;
  if (n === 0) return [];
  if (counts.reduce((s, c) => s + c, 0) <= 0) return counts.map(() => 0);
  if (n * min >= total) return counts.map(() => total / n);
  const fixed = new Set<number>();
  for (let iter = 0; iter <= n; iter++) {
    const free = counts.map((_, i) => i).filter((i) => !fixed.has(i));
    const budget = total - fixed.size * min;
    const freeSum = free.reduce((s, i) => s + counts[i], 0);
    const tooThin = free.filter((i) => (counts[i] / freeSum) * budget < min);
    if (tooThin.length === 0) break;
    for (const i of tooThin) fixed.add(i);
    if (fixed.size >= n) break;
  }
  const free = counts.map((_, i) => i).filter((i) => !fixed.has(i));
  if (free.length === 0) return counts.map(() => min);
  const budget = total - fixed.size * min;
  const freeSum = free.reduce((s, i) => s + counts[i], 0);
  return counts.map((c, i) => (fixed.has(i) ? min : (c / freeSum) * budget));
}

export type SegKind = "done" | "open";

export interface BandSeg {
  kind: SegKind;
  count: number;
  offset: number;
  thickness: number;
}

/** 帯の中の区切り。上から 終えた（濃い）／残り（薄い）。太さは件数の割合で、帯の太さは変わらない */
export function bandSegments(c: { done: number; open: number }, width: number): BandSeg[] {
  const total = c.done + c.open;
  if (total <= 0) return [];
  const out: BandSeg[] = [];
  let offset = 0;
  for (const [kind, count] of [["done", c.done], ["open", c.open]] as [SegKind, number][]) {
    if (count <= 0) continue;
    const thickness = (width * count) / total;
    out.push({ kind, count, offset, thickness });
    offset += thickness;
  }
  return out;
}

export type MineKind = "mine" | "others";

export interface MineSeg {
  kind: MineKind;
  count: number;
  offset: number;
  thickness: number;
}

/**
 * 「全て」のページの帯の区切り。上から あなたの分（濃い）／ほかの人の分（薄い）。
 * 太さは件数の割合で、帯の太さは変わらない。あなたの分が0なら全体が「ほかの人の分」、全部あなたの分なら全体が「あなたの分」
 */
export function mineSegments(mine: number, total: number, width: number): MineSeg[] {
  if (total <= 0) return [];
  const m = Math.min(Math.max(mine, 0), total);
  const out: MineSeg[] = [];
  let offset = 0;
  for (const [kind, count] of [["mine", m], ["others", total - m]] as [MineKind, number][]) {
    if (count <= 0) continue;
    const thickness = (width * count) / total;
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
  segments: BandSeg[];
  /** 「全て」のときだけ：この帯のうち、見ている人の仕事の件数と、その区切り */
  mine?: number;
  mineSegs?: MineSeg[];
  /** 帯のKR側の端に書く「完了 5／残り 3」の位置 */
  labelX: number;
  labelY: number;
}

export interface PjRow {
  /** 仕事ID（kind=task）またはPJのID（kind=pj。「ほか◯PJ」を開いたときの一覧） */
  id: string;
  kind: "task" | "pj";
  y: number;
}

export interface PjGeo {
  /** PJのID。まとめた枠は OTHER_PJ */
  pjId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** PJの件数（共有PJでも1回） */
  done: number;
  open: number;
  expanded: boolean;
  /** まとめた枠のときの、中身のPJ */
  members: { pjId: string; done: number; open: number }[];
  rows: PjRow[];
}

export interface KrGeo {
  krId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  done: number;
  open: number;
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

export interface TfGeo {
  tfId: string;
  krId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** このTFに流れ込む仕事の件数（TFは1つのKRにだけつながるので、仕事は1回ずつ） */
  done: number;
  open: number;
  /** 登録された仕事が無い（点線の枠で「仕事の登録なし」と出す） */
  empty: boolean;
  /** このTFへ帯がつながっているPJ */
  pjIds: string[];
}

export interface FlowLayout {
  width: number;
  height: number;
  cols: { personal: { x: number; w: number }; pj: { x: number; w: number }; tf: { x: number; w: number }; kr: { x: number; w: number }; o: { x: number; w: number } };
  pjNodes: PjGeo[];
  tfNodes: TfGeo[];
  krNodes: KrGeo[];
  o: OGeo;
  /** PJ→KR：TFを通らない帯（TFを置かないKRへ、または主たるKR以外へ直接つながる帯） */
  pjKr: Ribbon[];
  /** PJ→TF */
  pjTf: Ribbon[];
  /** TF→KR（labelX/labelY は帯のKR側の端の文字の位置） */
  tfKr: Ribbon[];
  krO: Ribbon[];
  loose: LooseGeo[];
  looseCount: number;
  looseTop: number;
  personal: PersonalGeo[];
}

interface NodeEdge {
  nodeId: string;
  krId: string;
  done: number;
  open: number;
  mine: number;
  /** この帯がTFを通るときのTF。通らない（直接KRへ）ときは null */
  tfId: string | null;
  /** PJから出るときの太さ */
  w: number;
}

/** TFの列の入力。pjTfId は PJ が置かれるTF（主たるKRのTF）。showEmpty は仕事の無いTFも枠を出すか */
export interface TfInput {
  tfs: { id: string; krId: string }[];
  pjTfId: Record<string, string | undefined>;
  showEmpty: boolean;
}

export function layoutFlow(args: {
  counts: FlowCounts;
  krIds: string[];
  /** 左端に個人OKRの列を出すとき、その個人OKRのID */
  personalIds: string[];
  expanded: string[];
  /** つながらない仕事を名前つきで並べるか（自分の表示だけ。チーム表示は件数だけ） */
  showLoose: boolean;
  maxPj?: number;
  /** 渡すと「全て」の描き分け用に、帯ごとの「見ている人の仕事の件数」を数える（仕事ID） */
  mineIds?: Set<string>;
  /** 渡すと、PJとKRの間にTFの列ができる（TFを置かないKRのPJは、列を素通りして直接KRへつながる） */
  tf?: TfInput;
}): FlowLayout {
  const { counts, krIds, personalIds, expanded, showLoose, mineIds } = args;
  const maxPj = args.maxPj ?? MAX_PJ;
  const withPersonal = personalIds.length > 0;
  const krIndex = (k: string) => krIds.indexOf(k);
  // TFの定義はKRの並び順にそろえる（KR内の並びは渡された順）
  const tfDefs = (args.tf?.tfs ?? []).filter((t) => krIndex(t.krId) >= 0).sort((a, b) => krIndex(a.krId) - krIndex(b.krId));
  const hasTfCol = tfDefs.length > 0;
  // 列が1つ増えても全体の幅（WIDTH）は変えない。TFの列の分だけ各列を詰める
  const cols = hasTfCol
    ? withPersonal
      ? { personal: { x: 0, w: 120 }, pj: { x: 140, w: 150 }, tf: { x: 330, w: 115 }, kr: { x: 630, w: 240 }, o: { x: 900, w: 100 } }
      : { personal: { x: 0, w: 120 }, pj: { x: 0, w: 190 }, tf: { x: 235, w: 125 }, kr: { x: 620, w: 250 }, o: { x: 900, w: 100 } }
    : {
        personal: { x: 0, w: 150 },
        pj: withPersonal ? { x: 190, w: 200 } : { x: 0, w: 240 },
        tf: { x: 0, w: 0 },
        kr: { x: 610, w: 250 },
        o: { x: 900, w: 100 },
      };

  // PJ：件数の多い順に maxPj 個まで。9以上のときは残りを「ほか◯PJ」にまとめる
  const total = (pjId: string) => (counts.linkedByPj[pjId] ?? []).length;
  const allPj = [...new Set(counts.edges.map((e) => e.pjId))];
  const ranked = [...allPj].sort((a, b) => total(b) - total(a) || a.localeCompare(b));
  const overflow = allPj.length > maxPj;
  const shown = overflow ? ranked.slice(0, maxPj) : ranked;
  const hidden = overflow ? ranked.slice(maxPj) : [];
  const membersOf = (nodeId: string) => (nodeId === OTHER_PJ ? hidden : [nodeId]);

  const nodeEdges: NodeEdge[] = [];
  const nodeIds = [...shown, ...(hidden.length ? [OTHER_PJ] : [])];
  for (const nodeId of nodeIds) {
    for (const k of krIds) {
      const es = counts.edges.filter((e) => e.krId === k && membersOf(nodeId).includes(e.pjId));
      if (es.length) {
        const mine = mineIds ? es.reduce((s, e) => s + e.taskIds.filter((id) => mineIds.has(id)).length, 0) : 0;
        // 帯がTFを通るのは、PJの置き先のTFが、この帯のKRのTFのとき。「ほか◯PJ」は直接つなぐ
        const pjTf = nodeId === OTHER_PJ ? undefined : args.tf?.pjTfId[nodeId];
        const tfId = pjTf && tfDefs.some((t) => t.id === pjTf && t.krId === k) ? pjTf : null;
        nodeEdges.push({ nodeId, krId: k, done: es.reduce((s, e) => s + e.done, 0), open: es.reduce((s, e) => s + e.open, 0), mine, tfId, w: 0 });
      }
    }
  }
  // PJの並び：つなぎ先の並び（KR→TF→直接）の早いものから。TFを使わないときは従来どおりKRの並び
  const rankOf = (e: NodeEdge) => krIndex(e.krId) * 100 + (e.tfId ? tfDefs.findIndex((t) => t.id === e.tfId) : 50);
  const primary = (nodeId: string) => Math.min(...nodeEdges.filter((e) => e.nodeId === nodeId).map(rankOf));
  nodeIds.sort((a, b) => (a === OTHER_PJ ? 1 : b === OTHER_PJ ? -1 : primary(a) - primary(b)));

  // 帯の太さ：各KRに流れ込む帯（TFを通る帯はTFごとにまとめて1本）を、そのKR向けの仕事件数の割合で分ける。
  // TFの中では、TFに入る帯の太さをPJの件数の割合でさらに分ける（TFを挟んでもKRに入る量は変わらない）
  const srcKey = (e: NodeEdge) => e.tfId ?? e.nodeId;
  const srcWidth = new Map<string, number>();
  for (const k of krIds) {
    const inc = nodeEdges.filter((e) => e.krId === k);
    const keys = [...new Set(inc.map(srcKey))];
    const countOf = (key: string) => inc.filter((e) => srcKey(e) === key).reduce((s, e) => s + e.done + e.open, 0);
    const ws = proportionalWidths(keys.map(countOf), KR_BAND, MIN_BAND);
    keys.forEach((key, i) => {
      srcWidth.set(`${key}>${k}`, ws[i]);
      const members = inc.filter((e) => srcKey(e) === key);
      const mw = members[0].tfId ? proportionalWidths(members.map((e) => e.done + e.open), ws[i], MIN_BAND) : [ws[i]];
      members.forEach((e, j) => (e.w = mw[j]));
    });
  }
  const wOf = (e: NodeEdge) => e.w;

  // PJノード
  let cursor = 0;
  const pjNodes: PjGeo[] = nodeIds.map((nodeId) => {
    const out = nodeEdges.filter((e) => e.nodeId === nodeId);
    const h = Math.max(PJ_MIN, out.reduce((s, e) => s + wOf(e), 0));
    const isOther = nodeId === OTHER_PJ;
    const linked = isOther ? [] : (counts.linkedByPj[nodeId] ?? []);
    const members = isOther
      ? hidden.map((id) => ({
          pjId: id,
          done: (counts.linkedByPj[id] ?? []).filter((t) => t.status === "完了").length,
          open: (counts.linkedByPj[id] ?? []).filter(isOpen).length,
        }))
      : [];
    const isExp = expanded.includes(nodeId);
    const rowCount = isOther ? members.length : linked.length;
    const rows: PjRow[] = isExp
      ? isOther
        ? members.map((m, i) => ({ id: m.pjId, kind: "pj" as const, y: cursor + h + 6 + i * ROW_H }))
        : linked.map((t, i) => ({ id: t.id, kind: "task" as const, y: cursor + h + 6 + i * ROW_H }))
      : [];
    const node: PjGeo = {
      pjId: nodeId,
      x: cols.pj.x,
      y: cursor,
      w: cols.pj.w,
      h,
      done: isOther ? members.reduce((s, m) => s + m.done, 0) : linked.filter((t) => t.status === "完了").length,
      open: isOther ? members.reduce((s, m) => s + m.open, 0) : linked.filter(isOpen).length,
      expanded: isExp,
      members,
      rows,
    };
    cursor += h + (isExp ? 6 + rowCount * ROW_H : 0) + NODE_GAP;
    return node;
  });
  const pjBottom = Math.max(0, cursor - NODE_GAP);
  const pjOf = (id: string) => pjNodes.find((n) => n.pjId === id)!;

  // TFノード：KRの並び順に積む。高さはPJと同じく、流れ出る帯の太さ（仕事が無いTFは最小の高さ）。PJの列の縦の中央に寄せる
  const tfEdges = (id: string) => nodeEdges.filter((e) => e.tfId === id);
  const tfShown = tfDefs.filter((t) => tfEdges(t.id).length > 0 || args.tf?.showEmpty);
  const tfW = (t: { id: string; krId: string }) => srcWidth.get(`${t.id}>${t.krId}`) ?? 0;
  const tfHeights = tfShown.map((t) => Math.max(PJ_MIN, tfW(t)));
  const tfColH = tfShown.length ? tfHeights.reduce((s, h) => s + h, 0) + (tfShown.length - 1) * NODE_GAP : 0;
  const tfOff = Math.max(0, (pjBottom - tfColH) / 2);
  let tfCursor = tfOff;
  const tfNodes: TfGeo[] = tfShown.map((t, i) => {
    const es = tfEdges(t.id);
    const node: TfGeo = {
      tfId: t.id,
      krId: t.krId,
      x: cols.tf.x,
      y: tfCursor,
      w: cols.tf.w,
      h: tfHeights[i],
      done: es.reduce((s, e) => s + e.done, 0),
      open: es.reduce((s, e) => s + e.open, 0),
      empty: es.length === 0,
      pjIds: es.map((e) => e.nodeId),
    };
    tfCursor += tfHeights[i] + NODE_GAP;
    return node;
  });
  const tfBottom = tfShown.length ? tfOff + tfColH : 0;
  const tfOf = (id: string) => tfNodes.find((n) => n.tfId === id)!;

  // KRノード：高さは固定。PJ・TFの列が高いときは縦の中央に寄せる
  const krColH = krIds.length ? krIds.length * KR_H + (krIds.length - 1) * KR_GAP : 0;
  const krOff = Math.max(0, (Math.max(pjBottom, tfBottom) - krColH) / 2);
  const krNodes: KrGeo[] = krIds.map((k, i) => {
    const es = nodeEdges.filter((e) => e.krId === k);
    return {
      krId: k,
      x: cols.kr.x,
      y: krOff + i * (KR_H + KR_GAP),
      w: cols.kr.w,
      h: KR_H,
      done: es.reduce((s, e) => s + e.done, 0),
      open: es.reduce((s, e) => s + e.open, 0),
    };
  });
  const krBottom = krOff + krColH;

  // O：高さは固定。KRの列の中央に置く
  const krMid = krNodes.length ? (krNodes[0].y + krNodes[krNodes.length - 1].y + KR_H) / 2 : O_H / 2;
  const oY = Math.max(0, krMid - O_H / 2);
  const uniq = [...new Map(Object.values(counts.linkedByPj).flat().map((t) => [t.id, t])).values()];
  const o: OGeo = { x: cols.o.x, y: oY, w: cols.o.w, h: O_H, done: uniq.filter((t) => t.status === "完了").length, open: uniq.filter(isOpen).length };

  // KRの手前の並び：KRに入る帯は、出どころ（TFを通る帯はTF、直接の帯はPJ）の縦の位置の順に並べる
  const pjKr: Ribbon[] = [];
  const pjTf: Ribbon[] = [];
  const tfKr: Ribbon[] = [];
  const srcY = (e: NodeEdge) => (e.tfId ? tfOf(e.tfId).y : pjOf(e.nodeId).y);
  const landing = new Map<string, { ty: number; ly: number }>();
  for (const k of krIds) {
    const kn = krNodes[krIndex(k)];
    const keys = new Map<string, { y: number; w: number }>();
    for (const e of nodeEdges.filter((x) => x.krId === k)) keys.set(srcKey(e), { y: srcY(e), w: srcWidth.get(`${srcKey(e)}>${k}`) ?? 0 });
    const inc = [...keys.entries()].sort((a, b) => a[1].y - b[1].y);
    const inSum = inc.reduce((s, [, v]) => s + v.w, 0);
    let before = 0;
    let lastLabel = -Infinity;
    for (const [key, v] of inc) {
      const ty = kn.y + (kn.h - inSum) / 2 + before;
      const ly = Math.max(ty + v.w / 2 + 4, lastLabel + LABEL_STEP);
      lastLabel = ly;
      landing.set(`${key}>${k}`, { ty, ly });
      before += v.w;
    }
  }
  // TFに入る帯の並び（TFの中では、PJの縦の位置の順）
  const tfLanding = new Map<string, number>();
  for (const tn of tfNodes) {
    const members = tfEdges(tn.tfId).sort((a, b) => pjOf(a.nodeId).y - pjOf(b.nodeId).y);
    const inSum = members.reduce((s, e) => s + wOf(e), 0);
    let before = 0;
    for (const e of members) {
      tfLanding.set(`${e.nodeId}>${tn.tfId}`, tn.y + (tn.h - inSum) / 2 + before);
      before += wOf(e);
    }
  }
  for (const pn of pjNodes) {
    const out = nodeEdges.filter((e) => e.nodeId === pn.pjId).sort((a, b) => krIndex(a.krId) - krIndex(b.krId));
    const outSum = out.reduce((s, e) => s + wOf(e), 0);
    let sy = pn.y + (pn.h - outSum) / 2;
    for (const e of out) {
      const w = wOf(e);
      const extra = mineIds ? { mine: e.mine, mineSegs: mineSegments(e.mine, e.done + e.open, w) } : {};
      if (e.tfId) {
        pjTf.push({
          id: `${pn.pjId}>${e.tfId}`,
          fromId: pn.pjId,
          toId: e.tfId,
          sx: pn.x + pn.w,
          sy,
          tx: tfOf(e.tfId).x,
          ty: tfLanding.get(`${e.nodeId}>${e.tfId}`) ?? 0,
          width: w,
          done: e.done,
          open: e.open,
          segments: bandSegments(e, w),
          ...extra,
          labelX: 0,
          labelY: 0,
        });
      } else {
        const kn = krNodes[krIndex(e.krId)];
        const land = landing.get(`${e.nodeId}>${e.krId}`);
        const tx = kn.x - LABEL_GAP;
        pjKr.push({
          id: `${pn.pjId}>${e.krId}`,
          fromId: pn.pjId,
          toId: e.krId,
          sx: pn.x + pn.w,
          sy,
          tx,
          ty: land?.ty ?? 0,
          width: w,
          done: e.done,
          open: e.open,
          segments: bandSegments(e, w),
          ...extra,
          labelX: tx + 8,
          labelY: land?.ly ?? 0,
        });
      }
      sy += w;
    }
  }
  for (const tn of tfNodes) {
    const es = tfEdges(tn.tfId);
    if (es.length === 0) continue;
    const kn = krNodes[krIndex(tn.krId)];
    const w = srcWidth.get(`${tn.tfId}>${tn.krId}`) ?? 0;
    const land = landing.get(`${tn.tfId}>${tn.krId}`);
    const tx = kn.x - LABEL_GAP;
    const mine = es.reduce((s, e) => s + e.mine, 0);
    tfKr.push({
      id: `${tn.tfId}>${tn.krId}`,
      fromId: tn.tfId,
      toId: tn.krId,
      sx: tn.x + tn.w,
      sy: tn.y + (tn.h - w) / 2,
      tx,
      ty: land?.ty ?? 0,
      width: w,
      done: tn.done,
      open: tn.open,
      segments: bandSegments(tn, w),
      ...(mineIds ? { mine, mineSegs: mineSegments(mine, tn.done + tn.open, w) } : {}),
      labelX: tx + 8,
      labelY: land?.ly ?? 0,
    });
  }

  // KR→Oの帯
  const krO: Ribbon[] = [];
  const active = krNodes.filter((n) => n.done + n.open > 0);
  const oWs = proportionalWidths(
    active.map((n) => n.done + n.open),
    O_BAND,
    MIN_BAND,
  );
  const mineOfKr = (k: string) => nodeEdges.filter((e) => e.krId === k).reduce((s, e) => s + e.mine, 0);
  const oSum = oWs.reduce((s, v) => s + v, 0);
  let ty = o.y + (o.h - oSum) / 2;
  active.forEach((kn, i) => {
    const w = oWs[i];
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
      segments: bandSegments(kn, w),
      ...(mineIds ? { mine: mineOfKr(kn.krId), mineSegs: mineSegments(mineOfKr(kn.krId), kn.done + kn.open, w) } : {}),
      labelX: 0,
      labelY: 0,
    });
    ty += w;
  });

  // 個人OKRの列（自分の表示のときだけ）
  const personal: PersonalGeo[] = personalIds.map((id, i) => ({ id, x: cols.personal.x, y: 4 + i * (PERSONAL_H + 18), w: cols.personal.w, h: PERSONAL_H }));
  const personalBottom = personal.length ? personal[personal.length - 1].y + PERSONAL_H : 0;

  // つながらない仕事：自分の表示では下に点線で並べ、チーム表示では件数だけ
  const mainBottom = Math.max(pjBottom, tfBottom, krBottom, o.y + o.h, personalBottom);
  const looseTop = mainBottom + 40;
  const loose: LooseGeo[] = showLoose ? counts.loose.map((t, i) => ({ taskId: t.id, x: 0, y: looseTop + 26 + i * (ROW_H + 4), w: cols.pj.x + cols.pj.w, h: ROW_H })) : [];
  const height = (loose.length ? loose[loose.length - 1].y + ROW_H : counts.loose.length > 0 ? looseTop + 22 : mainBottom) + 16;

  return { width: WIDTH, height, cols, pjNodes, tfNodes, krNodes, o, pjKr, pjTf, tfKr, krO, loose, looseCount: counts.loose.length, looseTop, personal };
}

/** 帯を描くパス（左→右のなだらかな曲線で囲んだ帯）。thickness 分だけ下にずらした側も含む */
export function ribbonPath(r: { sx: number; sy: number; tx: number; ty: number }, offset: number, thickness: number): string {
  const mx = (r.sx + r.tx) / 2;
  const a = r.sy + offset;
  const b = r.ty + offset;
  return `M ${r.sx} ${a} C ${mx} ${a}, ${mx} ${b}, ${r.tx} ${b} L ${r.tx} ${b + thickness} C ${mx} ${b + thickness}, ${mx} ${a + thickness}, ${r.sx} ${a + thickness} Z`;
}
