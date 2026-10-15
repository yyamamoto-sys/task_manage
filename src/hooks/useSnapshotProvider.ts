// src/hooks/useSnapshotProvider.ts
//
// ご意見のスナップショットの材料（画面が見えている設定）を登録するフック（v3.157・CLAUDE.md Section 82）。
// useUnsavedEditor と同じ作法：getter は ref 経由で常に最新の値を返し（effect は id が変わらない限り再実行しない）、
// アンマウントで必ず解除する。getter が返すのは「列挙値・数値・ID・真偽」だけ（文字列の業務データは返さない）。

import { useEffect, useId, useRef } from "react";
import { registerSnapshotProvider, type SnapshotProvider } from "../lib/feedback/snapshotContext";

export function useSnapshotProvider(id: string, getter: SnapshotProvider): void {
  const ref = useRef(getter);
  ref.current = getter;
  // 同じ画面が同時に2つ描画されても（AI提案のプレビューのガント等）、互いの登録を上書き・解除しない
  const instance = useId();
  useEffect(() => registerSnapshotProvider(`${id}:${instance}`, () => ref.current()), [id, instance]);
}
