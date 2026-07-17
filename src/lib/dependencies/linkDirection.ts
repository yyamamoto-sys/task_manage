// src/lib/dependencies/linkDirection.ts
//
// 【設計意図】ガント上でハンドルをドラッグして依存を直接結ぶ機能（B5）の方向解決ロジック。
// FS依存（Finish-to-Start）1種のみのため、「期日(due)側の端点＝先行」「開始(start)側の端点＝後続」
// という規約に固定する。どちらのハンドルからドラッグを始めても、ドロップ先が具体的なハンドルでなく
// バー本体（側が未確定＝null）の場合は、ドラッグ元の側から自動的に逆側を補って解決する。
// 結果として始点・終点の側が同じ（start同士／due同士）になる組み合わせはFS依存として表現できない
// ため NG（null）を返す。純粋関数のみ（DOM・store非依存）でユニットテストしやすくしている。

export type LinkSide = "start" | "due";

export interface LinkEndpoint {
  taskId: string;
  /** 具体的なハンドル（start/due）からのドラッグ／ドロップなら side、バー本体への漠然とした操作なら null */
  side: LinkSide | null;
}

export interface ResolvedLink {
  predecessorTaskId: string;
  successorTaskId: string;
}

/**
 * source（ドラッグ元）→ target（ドロップ先）から先行/後続を一意に決定する。
 * 解決できない（自己参照・start同士・due同士）場合は null。
 */
export function resolveLinkDirection(source: LinkEndpoint, target: LinkEndpoint): ResolvedLink | null {
  if (source.taskId === target.taskId) return null;

  let sourceSide = source.side;
  let targetSide = target.side;
  if (sourceSide === null && targetSide === null) return null;
  if (sourceSide === null) sourceSide = targetSide === "due" ? "start" : "due";
  if (targetSide === null) targetSide = sourceSide === "due" ? "start" : "due";
  if (sourceSide === targetSide) return null;

  return sourceSide === "due"
    ? { predecessorTaskId: source.taskId, successorTaskId: target.taskId }
    : { predecessorTaskId: target.taskId, successorTaskId: source.taskId };
}
