// src/components/list/useListInlineAdd.ts
//
// 【設計意図】
// リストのその場追加（ListInlineAddRow）の状態をまとめる。ListView.tsx をこれ以上膨らませない。
// - 下書きはグループごとに持つ（まとめ方を切り替えても入力が消えない）。
// - 登録は createInlineSubmitter（保存中は二重登録しない）経由。保存の実体は prepareNewTask＋saveTask
//   で、QuickAddTaskModal と同じ作成処理（group_id＝表示部署・変更履歴・ゲストの扱いは saveTask 側）。
// - 作ったタスクが今の絞り込みで見えないときはトーストで知らせる。
// - 名前が入った下書きがあるとき、画面遷移・部署切替・ログアウトの前に未保存の確認を出す
//   （CLAUDE.md Section 46。登録は unsavedEditorRegistry）。

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Task } from "../../lib/localData/types";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../lib/editing/unsavedEditorRegistry";
import {
  createInlineSubmitter, emptyDraft, isDraftDirty, type GroupAddSpec, type InlineDraft,
} from "../../lib/list/inlineAdd";
import { showToast } from "../common/Toast";

interface Params {
  userId: string;
  /** 表示部署内のタスク（採番の対象。QuickAddTaskModal と同じ） */
  scopedTasks: Task[];
  /** 非削除タスク全件／絞り込み後のタスク（作った直後に見えるかの判定用） */
  allTasks: Task[];
  filteredTasks: Task[];
  saveTask: (task: Task) => Promise<void>;
}

export function useListInlineAdd({ userId, scopedTasks, allTasks, filteredTasks, saveTask }: Params) {
  const [drafts, setDrafts] = useState<Record<string, InlineDraft>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ key: string; nonce: number } | null>(null);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const tasksRef = useRef(scopedTasks);
  tasksRef.current = scopedTasks;
  const saveRef = useRef(saveTask);
  saveRef.current = saveTask;
  const pendingVisibleRef = useRef<string | null>(null);
  const nonceRef = useRef(0);

  const submitter = useMemo(() => createInlineSubmitter({
    getTasks: () => tasksRef.current,
    // 保存の前に控える（ストアへの反映は同期で、描画後の確認より先に起きうるため）
    saveTask: t => { pendingVisibleRef.current = t.id; return saveRef.current(t); },
    userId,
  }), [userId]);

  const requestFocus = useCallback((key: string) => {
    nonceRef.current += 1;
    setFocusReq({ key, nonce: nonceRef.current });
  }, []);

  const open = useCallback((key: string, spec: GroupAddSpec) => {
    setDrafts(prev => (prev[key] ? prev : { ...prev, [key]: emptyDraft(spec, userId) }));
    requestFocus(key);
  }, [requestFocus, userId]);

  const change = useCallback((key: string, patch: Partial<InlineDraft>) => {
    setDrafts(prev => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }, []);

  const cancel = useCallback((key: string) => {
    setDrafts(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const submit = useCallback(async (key: string, spec: GroupAddSpec) => {
    const draft = draftsRef.current[key];
    if (!draft) return;
    setSavingKey(key);
    const result = await submitter.submit(draft, spec);
    setSavingKey(null);
    if (result.ok) {
      // 連続入力：同じグループの一番下に、すぐ次の空の追加行を出して名前欄へ戻る
      setDrafts(prev => ({ ...prev, [key]: emptyDraft(spec, userId) }));
      requestFocus(key);
      return;
    }
    pendingVisibleRef.current = null;
    if (result.reason === "dates" && result.message) showToast(result.message, "error");
    // empty は何もしない・busy は保存中の二重実行・error はストアが通知済み（下書きは残す）
  }, [submitter, requestFocus, userId]);

  // 作ったタスクが今の絞り込みで見えないときの案内
  useEffect(() => {
    const id = pendingVisibleRef.current;
    if (!id || !allTasks.some(t => t.id === id)) return;
    pendingVisibleRef.current = null;
    if (!filteredTasks.some(t => t.id === id)) {
      showToast("追加しました（今の絞り込みでは表示されません）", "info");
    }
  }, [allTasks, filteredTasks]);

  const editorId = useId();
  const dirtyRef = useRef(false);
  dirtyRef.current = Object.values(drafts).some(isDraftDirty);
  useEffect(() => {
    registerUnsavedEditor(editorId, () => dirtyRef.current);
    return () => unregisterUnsavedEditor(editorId);
  }, [editorId]);

  return { drafts, savingKey, focusReq, open, change, cancel, submit };
}
