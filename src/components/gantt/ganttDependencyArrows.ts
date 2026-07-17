// src/components/gantt/ganttDependencyArrows.ts
//
// 【設計意図】タスク依存関係（B1）フェーズB2：ガント上に依存の矢印を描くための純粋関数群。
// 行のY座標を数式で再計算せず、描画済みバーのDOM実測（getBoundingClientRect）から
// 得た矩形（TaskRect）だけを入力にする。3グルーピング×折りたたみ×フィルタの
// 全組合せでも「実際に描かれている場所」を正として矢印を引けるようにするための設計判断。

import type { TaskDependency } from "../../lib/localData/types";

/** 先行バー右端から少し外へ「蹴り出す」距離（px）。エルボーの最初の水平区間の長さ。 */
export const ARROW_KICK = 10;

export interface ArrowPoint {
  x: number;
  y: number;
}

/** ボディコンテナ基準の矩形（getBoundingClientRect の差分から作る） */
export interface TaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 先行バー右端中央→後続バー左端中央を結ぶ、直角エルボーの頂点列を返す。
 * 後続が先行より前から始まる（重なる／逆方向）場合は、右→縦→左→後続 の
 * S字迂回ルートにする（後続の左端へ必ず「右向きに」入るようにするため）。
 */
export function buildDependencyElbowPoints(predRight: ArrowPoint, succLeft: ArrowPoint): ArrowPoint[] {
  const kickX = predRight.x + ARROW_KICK;
  if (succLeft.x > kickX) {
    // 順方向：右に少し出す→垂直→後続バー左端へ
    return [
      predRight,
      { x: kickX, y: predRight.y },
      { x: kickX, y: succLeft.y },
      succLeft,
    ];
  }
  // 逆方向／近接：右→縦→左→後続へ回り込む（最後の区間は必ず右向きになるよう loopBackX を左に取る）
  const loopBackX = succLeft.x - ARROW_KICK;
  return [
    predRight,
    { x: kickX, y: predRight.y },
    { x: kickX, y: succLeft.y },
    { x: loopBackX, y: succLeft.y },
    succLeft,
  ];
}

/** 頂点列を SVG の path d 属性（折れ線）に変換する */
export function pointsToPathD(points: ArrowPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

export interface DependencyArrowGeometry {
  dep: TaskDependency;
  points: ArrowPoint[];
}

/** 相手（依存の反対側）が画面外（未実測＝非表示）だったタスクに立てるバッジ情報 */
export interface DependencyBadgeInfo {
  /** バッジを表示する対象タスク（画面に実測できた側） */
  taskId: string;
  /** 画面外にいる依存の相手タスク */
  otherTaskId: string;
  /** 画面外にいるのが「先行」か「後続」か（バッジの左右どちらに出すかの判断に使う） */
  hiddenSide: "predecessor" | "successor";
}

export interface DependencyRenderResult {
  arrows: DependencyArrowGeometry[];
  badgesByTaskId: Map<string, DependencyBadgeInfo[]>;
}

/**
 * 依存の両端が rectMap にある（＝実際に画面に描画されている）ペアだけ矢印座標を作る。
 * 片方だけ実測できた場合は、見えている側に「相手は画面外」バッジ情報を積む。
 * 両方とも実測できない依存（フィルタ・折りたたみ・別グループで両方非表示）は無視する。
 */
export function computeDependencyRenders(
  deps: TaskDependency[],
  rectMap: Map<string, TaskRect>,
): DependencyRenderResult {
  const arrows: DependencyArrowGeometry[] = [];
  const badgesByTaskId = new Map<string, DependencyBadgeInfo[]>();

  const addBadge = (taskId: string, otherTaskId: string, hiddenSide: "predecessor" | "successor") => {
    const arr = badgesByTaskId.get(taskId) ?? [];
    arr.push({ taskId, otherTaskId, hiddenSide });
    badgesByTaskId.set(taskId, arr);
  };

  for (const dep of deps) {
    const predRect = rectMap.get(dep.predecessor_task_id);
    const succRect = rectMap.get(dep.successor_task_id);
    if (predRect && succRect) {
      const predRight: ArrowPoint = { x: predRect.x + predRect.width, y: predRect.y + predRect.height / 2 };
      const succLeft: ArrowPoint = { x: succRect.x, y: succRect.y + succRect.height / 2 };
      arrows.push({ dep, points: buildDependencyElbowPoints(predRight, succLeft) });
    } else if (predRect && !succRect) {
      // 先行だけ見えている＝後続（相手）が画面外
      addBadge(dep.predecessor_task_id, dep.successor_task_id, "successor");
    } else if (!predRect && succRect) {
      // 後続だけ見えている＝先行（相手）が画面外
      addBadge(dep.successor_task_id, dep.predecessor_task_id, "predecessor");
    }
  }
  return { arrows, badgesByTaskId };
}
