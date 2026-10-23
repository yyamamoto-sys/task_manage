// src/hooks/useUnsavedEditor.ts
//
// 【設計意図・v3.155】
// 未保存編集レジストリ（src/lib/editing/unsavedEditorRegistry.ts・CLAUDE.md Section 46）への
// 登録・解除をまとめたフック。登録の書き忘れ・解除漏れ・コピペを防ぐため、設定画面の編集フォーム
// （プロフィール・パスワード・AdminView のルート）はすべてこれを使う。
// getter は ref 経由で常に最新の isDirty を返す（effect は id が変わらない限り再実行しない）。
// options.survivesViewSwitch は下書きがストアに残る画面用（v3.185・資料インプット）。

import { useEffect, useId, useRef } from "react";
import {
  registerUnsavedEditor, unregisterUnsavedEditor, type UnsavedEditorOptions,
} from "../lib/editing/unsavedEditorRegistry";

export function useUnsavedEditor(isDirty: boolean, options?: UnsavedEditorOptions): void {
  const id = useId();
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const survives = options?.survivesViewSwitch === true;
  useEffect(() => {
    registerUnsavedEditor(id, () => dirtyRef.current, { survivesViewSwitch: survives });
    return () => unregisterUnsavedEditor(id);
  }, [id, survives]);
}
